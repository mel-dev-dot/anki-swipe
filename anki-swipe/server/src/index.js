import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import AppleStrategy from "passport-apple";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { generateEnrichment } from "./enrich.js";
import { getRelatedKanji } from "./kanjiComponents.js";

const prisma = new PrismaClient();
const app = express();

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

const upsertOAuthUser = async ({ provider, providerUserId, email, name, avatarUrl }) => {
  const existingProvider = await prisma.authProvider.findUnique({
    where: {
      provider_providerUserId: {
        provider,
        providerUserId,
      },
    },
    include: { user: true },
  });

  if (existingProvider?.user) {
    return existingProvider.user;
  }

  let user = null;
  if (email) {
    user = await prisma.user.findUnique({ where: { email } });
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: email ?? null,
        name: name ?? null,
        avatarUrl: avatarUrl ?? null,
      },
    });
  } else if (!user.name || !user.avatarUrl) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: user.name || name || null,
        avatarUrl: user.avatarUrl || avatarUrl || null,
      },
    });
  }

  await prisma.authProvider.create({
    data: {
      provider,
      providerUserId,
      email: email ?? null,
      userId: user.id,
    },
  });

  return user;
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      callbackURL: `${process.env.SERVER_BASE_URL || "http://localhost:3001"}/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const user = await upsertOAuthUser({
          provider: "google",
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          avatarUrl: profile.photos?.[0]?.value,
        });
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.use(
  new AppleStrategy(
    {
      clientID: process.env.APPLE_CLIENT_ID || "",
      teamID: process.env.APPLE_TEAM_ID || "",
      keyID: process.env.APPLE_KEY_ID || "",
      privateKey: process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n") || "",
      callbackURL: `${process.env.SERVER_BASE_URL || "http://localhost:3001"}/auth/apple/callback`,
      scope: ["name", "email"],
    },
    async (_accessToken, _refreshToken, idToken, profile, done) => {
      try {
        const email = profile?.email;
        const name =
          profile?.name ? `${profile.name.firstName || ""} ${profile.name.lastName || ""}`.trim() : null;
        const user = await upsertOAuthUser({
          provider: "apple",
          providerUserId: idToken,
          email,
          name: name || null,
          avatarUrl: null,
        });
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: `${CLIENT_ORIGIN}/?auth=failed` }),
  (_req, res) => {
    res.redirect(`${CLIENT_ORIGIN}/?auth=success`);
  }
);

app.get("/auth/apple", passport.authenticate("apple"));

app.post(
  "/auth/apple/callback",
  passport.authenticate("apple", { failureRedirect: `${CLIENT_ORIGIN}/?auth=failed` }),
  (_req, res) => {
    res.redirect(`${CLIENT_ORIGIN}/?auth=success`);
  }
);

app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  const { id, email, name, avatarUrl } = req.user;
  res.json({ user: { id, email, name, avatarUrl } });
});

app.post("/api/auth/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

const loginUser = (req, res, user) =>
  req.login(user, (err) => {
    if (err) {
      res.status(500).json({ error: "Login failed" });
      return;
    }
    const { id, email, name, avatarUrl } = user;
    res.json({ user: { id, email, name, avatarUrl } });
  });

app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let user = existing;
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: name || null, passwordHash },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, name: user.name || name || null },
    });
  }

  loginUser(req, res, user);
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  loginUser(req, res, user);
});

const requireAuth = (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
};

const MIN_EASE = 1.3;
const now = () => Date.now();
const EASY_MS = 4000;
const GOOD_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEARNING_STEPS_MINUTES = [10, 60, 240]; // 3x in a day

const normalizeRating = (rating, answerMs, isCorrect) => {
  if (typeof rating === "number" && rating > 0) return rating;
  if (!isCorrect) return 2;
  if (!answerMs) return 4;
  if (answerMs <= EASY_MS) return 5;
  if (answerMs <= GOOD_MS) return 4;
  return 3;
};

const updateReviewCard = (record, rating, answerMs) => {
  const seen = record.seen + 1;
  const isCorrect = rating >= 3;
  const correct = record.correct + (isCorrect ? 1 : 0);
  const wrong = record.wrong + (isCorrect ? 0 : 1);
  let ease = record.ease ?? 2.5;
  let intervalDays = record.intervalDays ?? 0;
  let reps = record.reps ?? 0;
  let lapses = record.lapses ?? 0;
  let learningStep = record.learningStep ?? 0;
  const q = rating;

  const inLearning = reps === 0 || learningStep < LEARNING_STEPS_MINUTES.length;
  let dueAt;

  if (inLearning) {
    if (q < 3) {
      lapses += 1;
      reps = 0;
      learningStep = 0;
      intervalDays = 0;
      ease = Math.max(MIN_EASE, ease - 0.2);
      dueAt = new Date(now() + LEARNING_STEPS_MINUTES[0] * 60 * 1000);
    } else {
      if (learningStep < LEARNING_STEPS_MINUTES.length - 1) {
        learningStep += 1;
        intervalDays = 0;
        dueAt = new Date(now() + LEARNING_STEPS_MINUTES[learningStep] * 60 * 1000);
      } else {
        // graduate
        reps = 1;
        learningStep = LEARNING_STEPS_MINUTES.length;
        intervalDays = q >= 5 ? 2 : 1;
        dueAt = new Date(now() + intervalDays * DAY_MS);
      }
      ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      if (ease < MIN_EASE) ease = MIN_EASE;
    }
  } else {
    if (q < 3) {
      lapses += 1;
      reps = 0;
      learningStep = 0;
      intervalDays = 0;
      ease = Math.max(MIN_EASE, ease - 0.2);
      dueAt = new Date(now() + LEARNING_STEPS_MINUTES[0] * 60 * 1000);
    } else {
      reps += 1;
      if (reps === 1) intervalDays = 1;
      else if (reps === 2) intervalDays = 6;
      else intervalDays = Math.max(1, Math.round(intervalDays * ease));
      ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      if (ease < MIN_EASE) ease = MIN_EASE;
      dueAt = new Date(now() + intervalDays * DAY_MS);
    }
  }
  const avgAnswerMs =
    record.avgAnswerMs === 0
      ? answerMs
      : Math.round(record.avgAnswerMs * 0.7 + answerMs * 0.3);

  return {
    seen,
    correct,
    wrong,
    intervalIndex: reps,
    intervalDays,
    ease,
    reps,
    lapses,
    dueAt,
    learningStep,
    lastCorrect: isCorrect,
    lastAnsweredAt: new Date(),
    lastReviewedAt: new Date(),
    lastAnswerMs: answerMs,
    avgAnswerMs,
  };
};

const DEFAULT_LEVELS = ["N5", "N4", "N3", "N2", "N1"];

const mapLifecycleCard = (card) => ({
  id: card.id,
  script: card.script,
  meaning: card.meaning,
  level: card.groupKey,
  order: card.order ?? 9999,
  reviewCount: card.review?.seen ?? 0,
  intervalDays: card.review?.intervalDays ?? 0,
  lastReviewedAt: card.review?.lastReviewedAt ?? null,
});

app.get("/api/decks", async (_req, res) => {
  const decks = await prisma.deck.findMany({
    include: {
      groups: {
        include: {
          cards: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const response = decks.map((deck) => ({
    id: deck.id,
    label: deck.label,
    groups: deck.groups.map((group) => ({
      id: group.key,
      label: group.label,
      cards: group.cards.map((card) => ({
        id: card.id,
        script: card.script,
        romaji: card.romaji,
        meaning: card.meaning,
        onyomi: card.onyomi,
        kunyomi: card.kunyomi,
      })),
    })),
  }));

  res.json(response);
});

const mapExample = (example) =>
  example
    ? {
        sentence: example.sentence,
        reading: example.reading,
        readingReason: example.readingReason,
        romaji: example.romaji,
        translation: example.translation,
        breakdown: example.breakdown,
        grammarNotes: example.grammarNotes,
      }
    : null;

// Demo-only endpoint: lets an unauthenticated user read a few kanji before sign-in.
// It does NOT write any progress or create review cards.
app.get("/api/demo/kanji/learn", async (req, res) => {
  const limit = Math.max(1, Math.min(10, Number(req.query.limit || 3)));
  const level = String(req.query.level || "N5");

  const cards = await prisma.card.findMany({
    where: {
      deckId: "kanji",
      ...(level ? { groupKey: level } : {}),
    },
    orderBy: { order: "asc" },
    take: limit,
    include: { examples: true, enrichment: true },
  });

  const response = cards
    .map((card) => {
      const examples = card.examples?.length
        ? card.examples.map(mapExample)
        : card.enrichment
          ? [mapExample(card.enrichment)]
          : [];
      if (!examples.length) return null;
      return {
        id: card.id,
        deck: card.deckId,
        group: card.groupKey,
        script: card.script,
        romaji: card.romaji,
        meaning: card.meaning,
        onyomi: card.onyomi,
        kunyomi: card.kunyomi,
        order: card.order,
        examples,
      };
    })
    .filter(Boolean);

  res.json(response);
});

app.get("/api/kanji/learn", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const level = req.query.level;
  const progress = await prisma.learningProgress.findFirst({
    where: { userId: req.user.id },
  });
  const startOrder = progress?.nextOrder ?? 0;

  const learned = await prisma.reviewCard.findMany({
    where: { deck: "kanji", userId: req.user.id },
    select: { cardId: true },
  });
  const learnedIds = learned.map((item) => item.cardId);

  const cards = await prisma.card.findMany({
    where: {
      deckId: "kanji",
      ...(level ? {} : { order: { gte: startOrder } }),
      ...(level ? { groupKey: level } : {}),
      ...(learnedIds.length ? { id: { notIn: learnedIds } } : {}),
    },
    orderBy: { order: "asc" },
    take: limit,
    include: { examples: true, enrichment: true },
  });

  const response = cards
    .map((card) => {
      const examples = card.examples?.length
        ? card.examples.map(mapExample)
        : card.enrichment
          ? [mapExample(card.enrichment)]
          : [];
      if (!examples.length) return null;
      return {
        id: card.id,
        deck: card.deckId,
        group: card.groupKey,
        script: card.script,
        romaji: card.romaji,
        meaning: card.meaning,
        onyomi: card.onyomi,
        kunyomi: card.kunyomi,
        order: card.order,
        examples,
      };
    })
    .filter(Boolean);

  res.json(response);
});

app.get("/api/kanji/learned", requireAuth, async (req, res) => {
  const learned = await prisma.reviewCard.findMany({
    where: { deck: "kanji", userId: req.user.id },
    select: { cardId: true },
  });
  const cardIds = learned.map((item) => item.cardId);
  if (!cardIds.length) {
    res.json([]);
    return;
  }

  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
    include: { examples: true, enrichment: true },
    orderBy: { order: "asc" },
  });

  const response = cards
    .map((card) => {
      const examples = card.examples?.length
        ? card.examples.map(mapExample)
        : card.enrichment
          ? [mapExample(card.enrichment)]
          : [];
      if (!examples.length) return null;
      return {
        id: card.id,
        deck: card.deckId,
        group: card.groupKey,
        script: card.script,
        romaji: card.romaji,
        meaning: card.meaning,
        onyomi: card.onyomi,
        kunyomi: card.kunyomi,
        order: card.order,
        examples,
      };
    })
    .filter(Boolean);

  res.json(response);
});

app.get("/api/kanji/card/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const card = await prisma.card.findUnique({
    where: { id },
    include: { examples: true, enrichment: true },
  });
  if (!card) {
    res.status(404).json({ error: "card not found" });
    return;
  }

  const examples = card.examples?.length
    ? card.examples.map(mapExample)
    : card.enrichment
      ? [mapExample(card.enrichment)]
      : [];

  res.json({
    id: card.id,
    deck: card.deckId,
    group: card.groupKey,
    script: card.script,
    romaji: card.romaji,
    meaning: card.meaning,
    onyomi: card.onyomi,
    kunyomi: card.kunyomi,
    order: card.order,
    examples,
  });
});

app.get("/api/kanji/lifecycle", requireAuth, async (req, res) => {
  const levelsParam = String(req.query.levels || "")
    .split(",")
    .map((level) => level.trim())
    .filter(Boolean);
  const levels = levelsParam.length ? levelsParam : DEFAULT_LEVELS;

  const cards = await prisma.card.findMany({
    where: {
      deckId: "kanji",
      ...(levels.length ? { groupKey: { in: levels } } : {}),
    },
    orderBy: { order: "asc" },
  });

  const reviewCards = await prisma.reviewCard.findMany({
    where: { userId: req.user.id, deck: "kanji" },
  });
  const reviewByCardId = reviewCards.reduce((acc, rc) => {
    acc[rc.cardId] = rc;
    return acc;
  }, {});

  const toLearn = [];
  const learning = [];
  const mastered = [];

  for (const card of cards) {
    const review = reviewByCardId[card.id] || null;
    if (!review) {
      toLearn.push(mapLifecycleCard({ ...card, review: null }));
    } else if ((review.intervalDays ?? 0) >= 10) {
      mastered.push(mapLifecycleCard({ ...card, review }));
    } else {
      learning.push(mapLifecycleCard({ ...card, review }));
    }
  }

  const lastReviewed = cards
    .map((card) => ({ ...card, review: reviewByCardId[card.id] || null }))
    .filter((card) => card.review?.lastReviewedAt)
    .sort(
      (a, b) =>
        new Date(b.review.lastReviewedAt).getTime() -
        new Date(a.review.lastReviewedAt).getTime()
    )[0];

  const suggestionTarget = (() => {
    if (!lastReviewed) return null;
    const related = getRelatedKanji(
      lastReviewed.script,
      toLearn.map((card) => card.script)
    );
    if (!related.length) return null;
    const match = toLearn.find((card) => card.script === related[0].kanji);
    if (match) return { card: match, reason: "related", overlap: related[0].overlap };
    return null;
  })();

  const suggestion = suggestionTarget
    ? {
        from: lastReviewed ? mapLifecycleCard(lastReviewed) : null,
        to: suggestionTarget.card,
        message:
          suggestionTarget.reason === "related" && lastReviewed
            ? `You just learned “${lastReviewed.script}”. Want to learn “${suggestionTarget.card.script}” next? It shares components (${(suggestionTarget.overlap || []).join(
                ", "
              )}).`
            : `Suggested next: “${suggestionTarget.card.script}” (${suggestionTarget.card.level}).`,
      }
    : null;

  res.json({
    levels,
    toLearn,
    learning,
    mastered,
    suggestion,
  });
});

app.get("/api/review", requireAuth, async (req, res) => {
  const review = await prisma.reviewCard.findMany({
    where: { userId: req.user.id },
  });
  res.json(review);
});

app.get("/api/review/due", requireAuth, async (req, res) => {
  const { deckId } = req.query;
  const limit = Number(req.query.limit || 10);
  const reviewCards = await prisma.reviewCard.findMany({
    where: {
      ...(deckId ? { deck: deckId } : {}),
      userId: req.user.id,
      dueAt: { lte: new Date() },
    },
  });

  if (reviewCards.length === 0) {
    res.json([]);
    return;
  }

  const scored = reviewCards.map((card) => {
    const wrongRate = card.seen ? card.wrong / card.seen : 0;
    const avgMs = card.avgAnswerMs || 0;
    const recentWrong = card.lastCorrect === false ? 1 : 0;
    const score = wrongRate * 3 + avgMs / 4000 + recentWrong * 2;
    return { card, score };
  });

  const prioritized = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((item) => item.card);

  const cardIds = prioritized.map((card) => card.cardId);
  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
  });

  const cardMap = cards.reduce((acc, card) => {
    acc[card.id] = card;
    return acc;
  }, {});

  const response = prioritized
    .map((review) => {
      const card = cardMap[review.cardId];
      if (!card) return null;
      return {
        id: card.id,
        deck: card.deckId,
        group: card.groupKey,
        script: card.script,
        romaji: card.romaji,
        meaning: card.meaning,
        onyomi: card.onyomi,
        kunyomi: card.kunyomi,
        review,
      };
    })
    .filter(Boolean);

  res.json(response);
});

app.post("/api/review/seed", requireAuth, async (req, res) => {
  const cards = await prisma.card.findMany();
  const existing = await prisma.reviewCard.findMany({
    where: { userId: req.user.id },
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const createList = cards
    .filter((card) => !existingSet.has(card.id))
    .map((card) => ({
      userId: req.user.id,
      cardId: card.id,
      deck: card.deckId,
      group: card.groupKey,
      intervalIndex: 0,
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      dueAt: new Date(),
      seen: 0,
      correct: 0,
      wrong: 0,
      lastCorrect: true,
      lastAnsweredAt: new Date(0),
      lastReviewedAt: new Date(0),
      lastAnswerMs: 0,
      avgAnswerMs: 0,
    }));

  if (createList.length) {
    await prisma.reviewCard.createMany({ data: createList, skipDuplicates: true });
  }

  res.json({ created: createList.length });
});

app.post("/api/kanji/enrich", async (req, res) => {
  const { cardIds, level, limit } = req.body ?? {};
  const take = Number(limit || 10);

  const whereClause = cardIds?.length
    ? { id: { in: cardIds } }
    : {
        deckId: "kanji",
        ...(level ? { groupKey: level } : {}),
      };

  const cards = await prisma.card.findMany({
    where: whereClause,
    take,
  });

  const existing = await prisma.kanjiEnrichment.findMany({
    where: { cardId: { in: cards.map((card) => card.id) } },
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const results = [];

  for (const card of cards) {
    if (existingSet.has(card.id)) continue;
    try {
      const payload = await generateEnrichment(card, level || card.groupKey);
      const saved = await prisma.kanjiEnrichment.create({
        data: {
          id: `enrich-${card.id}`,
          cardId: card.id,
          source: "openai",
          model: payload.model,
          sentence: payload.sentence,
          reading: payload.reading,
          readingReason: payload.readingReason,
          romaji: payload.romaji,
          translation: payload.translation,
          breakdown: payload.breakdown,
          grammarNotes: payload.grammarNotes,
          difficultyScore: payload.difficultyScore,
          difficultyNotes: payload.difficultyNotes,
        },
      });
      results.push({ cardId: card.id, status: "created", id: saved.id });
    } catch (error) {
      results.push({
        cardId: card.id,
        status: "failed",
        error: error.message,
      });
    }
  }

  res.json({ processed: results.length, results });
});

app.post("/api/progress/reset", requireAuth, async (req, res) => {
  await prisma.reviewCard.deleteMany({ where: { userId: req.user.id } });
  await prisma.learningProgress.upsert({
    where: { userId: req.user.id },
    update: { nextOrder: 0 },
    create: { userId: req.user.id, nextOrder: 0 },
  });
  res.json({ reset: true });
});

app.post("/api/review/add-group", requireAuth, async (req, res) => {
  const { deckId, groupId } = req.body;
  if (!deckId || !groupId) {
    res.status(400).json({ error: "deckId and groupId required" });
    return;
  }

  const groupKey = `${deckId}-${groupId}`;
  const cards = await prisma.card.findMany({
    where: { groupId: groupKey },
  });

  const existing = await prisma.reviewCard.findMany({
    where: { userId: req.user.id },
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const createList = cards
    .filter((card) => !existingSet.has(card.id))
    .map((card) => ({
      userId: req.user.id,
      cardId: card.id,
      deck: card.deckId,
      group: card.groupKey,
      intervalIndex: 0,
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      dueAt: new Date(),
      seen: 0,
      correct: 0,
      wrong: 0,
      lastCorrect: true,
      lastAnsweredAt: new Date(0),
      lastReviewedAt: new Date(0),
      lastAnswerMs: 0,
      avgAnswerMs: 0,
    }));

  if (createList.length) {
    await prisma.reviewCard.createMany({ data: createList, skipDuplicates: true });
  }

  res.json({ created: createList.length });
});

app.post("/api/review/add-cards", requireAuth, async (req, res) => {
  const { cardIds } = req.body;
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    res.status(400).json({ error: "cardIds required" });
    return;
  }

  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
  });

  const existing = await prisma.reviewCard.findMany({
    where: { userId: req.user.id, cardId: { in: cardIds } },
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const createList = cards
    .filter((card) => !existingSet.has(card.id))
    .map((card) => ({
      userId: req.user.id,
      cardId: card.id,
      deck: card.deckId,
      group: card.groupKey,
      intervalIndex: 0,
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      dueAt: new Date(),
      seen: 0,
      correct: 0,
      wrong: 0,
      lastCorrect: true,
      lastAnsweredAt: new Date(0),
      lastReviewedAt: new Date(0),
      lastAnswerMs: 0,
      avgAnswerMs: 0,
    }));

  if (createList.length) {
    await prisma.reviewCard.createMany({ data: createList, skipDuplicates: true });
  }

  const maxOrder = cards.reduce((max, card) => {
    if (typeof card.order !== "number") return max;
    return Math.max(max, card.order);
  }, -1);
  if (maxOrder >= 0) {
    const progress = await prisma.learningProgress.findFirst({
      where: { userId: req.user.id },
    });
    const nextOrder = Math.max(progress?.nextOrder ?? 0, maxOrder + 1);
    await prisma.learningProgress.upsert({
      where: { userId: req.user.id },
      update: { nextOrder },
      create: { userId: req.user.id, nextOrder },
    });
  }

  res.json({ created: createList.length });
});

app.post("/api/review/answer", requireAuth, async (req, res) => {
  const { cardId, isCorrect, answerMs, rating } = req.body;
  if (!cardId) {
    res.status(400).json({ error: "cardId required" });
    return;
  }

  let review = await prisma.reviewCard.findUnique({
    where: { userId_cardId: { userId: req.user.id, cardId } },
  });

  if (!review) {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      res.status(404).json({ error: "card not found" });
      return;
    }

    review = await prisma.reviewCard.create({
      data: {
        userId: req.user.id,
        cardId: card.id,
        deck: card.deckId,
        group: card.groupKey,
        intervalIndex: 0,
        intervalDays: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
        learningStep: 0,
        dueAt: new Date(),
        seen: 0,
        correct: 0,
        wrong: 0,
        lastCorrect: true,
        lastAnsweredAt: new Date(0),
        lastReviewedAt: new Date(0),
        lastAnswerMs: 0,
        avgAnswerMs: 0,
      },
    });
  }

  const resolvedRating = normalizeRating(rating, Number(answerMs || 0), Boolean(isCorrect));
  const updates = updateReviewCard(review, resolvedRating, Number(answerMs || 0));

  const updated = await prisma.reviewCard.update({
    where: { userId_cardId: { userId: req.user.id, cardId } },
    data: updates,
  });

  res.json(updated);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
