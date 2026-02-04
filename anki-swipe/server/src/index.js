import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { generateEnrichment } from "./enrich.js";
import { getRelatedKanji } from "./kanjiComponents.js";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

const MIN_EASE = 1.3;
const now = () => Date.now();
const EASY_MS = 4000;
const GOOD_MS = 8000;

const getQuality = (isCorrect, answerMs) => {
  if (!isCorrect) return 2;
  if (!answerMs) return 4;
  if (answerMs <= EASY_MS) return 5;
  if (answerMs <= GOOD_MS) return 4;
  return 3;
};

const updateReviewCard = (record, isCorrect, answerMs) => {
  const seen = record.seen + 1;
  const correct = record.correct + (isCorrect ? 1 : 0);
  const wrong = record.wrong + (isCorrect ? 0 : 1);
  let ease = record.ease ?? 2.5;
  let intervalDays = record.intervalDays ?? 0;
  let reps = record.reps ?? 0;
  let lapses = record.lapses ?? 0;
  const q = getQuality(isCorrect, answerMs);

  if (q < 3) {
    lapses += 1;
    reps = 0;
    intervalDays = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
  } else {
    reps += 1;
    if (reps === 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * ease));
    ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ease < MIN_EASE) ease = MIN_EASE;
  }

  const dueAt = new Date(now() + intervalDays * 24 * 60 * 60 * 1000);
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

app.get("/api/kanji/learn", async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const level = req.query.level;
  const progress = await prisma.learningProgress.findUnique({
    where: { id: "default" },
  });
  const startOrder = progress?.nextOrder ?? 0;

  const learned = await prisma.reviewCard.findMany({
    where: { deck: "kanji" },
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
      const example = card.examples[0]
        ? mapExample(card.examples[0])
        : mapExample(card.enrichment);
      if (!example) return null;
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
        example,
      };
    })
    .filter(Boolean);

  res.json(response);
});

app.get("/api/kanji/learned", async (_req, res) => {
  const learned = await prisma.reviewCard.findMany({
    where: { deck: "kanji" },
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
      const example = card.examples[0]
        ? mapExample(card.examples[0])
        : mapExample(card.enrichment);
      if (!example) return null;
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
        example,
      };
    })
    .filter(Boolean);

  res.json(response);
});

app.get("/api/kanji/lifecycle", async (req, res) => {
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
    include: { review: true },
    orderBy: { order: "asc" },
  });

  const toLearn = [];
  const learning = [];
  const mastered = [];

  for (const card of cards) {
    const review = card.review;
    if (!review || review.seen === 0) {
      toLearn.push(mapLifecycleCard(card));
    } else if ((review.intervalDays ?? 0) >= 10) {
      mastered.push(mapLifecycleCard(card));
    } else {
      learning.push(mapLifecycleCard(card));
    }
  }

  const lastReviewed = cards
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

app.get("/api/review", async (_req, res) => {
  const review = await prisma.reviewCard.findMany();
  res.json(review);
});

app.get("/api/review/due", async (req, res) => {
  const { deckId } = req.query;
  const limit = Number(req.query.limit || 10);
  const reviewCards = await prisma.reviewCard.findMany({
    where: {
      ...(deckId ? { deck: deckId } : {}),
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

app.post("/api/review/seed", async (_req, res) => {
  const cards = await prisma.card.findMany();
  const existing = await prisma.reviewCard.findMany({
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const createList = cards
    .filter((card) => !existingSet.has(card.id))
    .map((card) => ({
      id: `review-${card.id}`,
      cardId: card.id,
      deck: card.deckId,
      group: card.groupKey,
      intervalIndex: 0,
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
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

app.post("/api/progress/reset", async (_req, res) => {
  await prisma.reviewCard.deleteMany();
  await prisma.learningProgress.upsert({
    where: { id: "default" },
    update: { nextOrder: 0 },
    create: { id: "default", nextOrder: 0 },
  });
  res.json({ reset: true });
});

app.post("/api/review/add-group", async (req, res) => {
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
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const createList = cards
    .filter((card) => !existingSet.has(card.id))
    .map((card) => ({
      id: `review-${card.id}`,
      cardId: card.id,
      deck: card.deckId,
      group: card.groupKey,
      intervalIndex: 0,
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
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

app.post("/api/review/add-cards", async (req, res) => {
  const { cardIds } = req.body;
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    res.status(400).json({ error: "cardIds required" });
    return;
  }

  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
  });

  const existing = await prisma.reviewCard.findMany({
    where: { cardId: { in: cardIds } },
    select: { cardId: true },
  });
  const existingSet = new Set(existing.map((item) => item.cardId));

  const createList = cards
    .filter((card) => !existingSet.has(card.id))
    .map((card) => ({
      id: `review-${card.id}`,
      cardId: card.id,
      deck: card.deckId,
      group: card.groupKey,
      intervalIndex: 0,
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
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
    const progress = await prisma.learningProgress.findUnique({
      where: { id: "default" },
    });
    const nextOrder = Math.max(progress?.nextOrder ?? 0, maxOrder + 1);
    await prisma.learningProgress.upsert({
      where: { id: "default" },
      update: { nextOrder },
      create: { id: "default", nextOrder },
    });
  }

  res.json({ created: createList.length });
});

app.post("/api/review/answer", async (req, res) => {
  const { cardId, isCorrect, answerMs } = req.body;
  if (!cardId) {
    res.status(400).json({ error: "cardId required" });
    return;
  }

  let review = await prisma.reviewCard.findUnique({
    where: { cardId },
  });

  if (!review) {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      res.status(404).json({ error: "card not found" });
      return;
    }

    review = await prisma.reviewCard.create({
      data: {
        id: `review-${card.id}`,
        cardId: card.id,
        deck: card.deckId,
        group: card.groupKey,
        intervalIndex: 0,
        intervalDays: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
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

  const updates = updateReviewCard(review, Boolean(isCorrect), Number(answerMs || 0));

  const updated = await prisma.reviewCard.update({
    where: { cardId },
    data: updates,
  });

  res.json(updated);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
