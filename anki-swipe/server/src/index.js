import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

const REVIEW_INTERVALS = [1, 2, 4, 7, 14, 30];
const now = () => Date.now();

const updateReviewCard = (record, isCorrect, answerMs) => {
  const seen = record.seen + 1;
  const correct = record.correct + (isCorrect ? 1 : 0);
  const wrong = record.wrong + (isCorrect ? 0 : 1);
  const nextIntervalIndex = isCorrect
    ? Math.min(record.intervalIndex + 1, REVIEW_INTERVALS.length - 1)
    : 0;
  const intervalDays = REVIEW_INTERVALS[nextIntervalIndex];
  const dueAt = new Date(now() + intervalDays * 24 * 60 * 60 * 1000);
  const avgAnswerMs =
    record.avgAnswerMs === 0
      ? answerMs
      : Math.round(record.avgAnswerMs * 0.7 + answerMs * 0.3);

  return {
    seen,
    correct,
    wrong,
    intervalIndex: nextIntervalIndex,
    dueAt,
    lastAnswerMs: answerMs,
    avgAnswerMs,
  };
};

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

app.get("/api/review", async (_req, res) => {
  const review = await prisma.reviewCard.findMany();
  res.json(review);
});

app.get("/api/review/due", async (req, res) => {
  const { deckId } = req.query;
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

  const cardIds = reviewCards.map((card) => card.cardId);
  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
  });

  const cardMap = cards.reduce((acc, card) => {
    acc[card.id] = card;
    return acc;
  }, {});

  const response = reviewCards
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
      dueAt: new Date(),
      seen: 0,
      correct: 0,
      wrong: 0,
      lastAnswerMs: 0,
      avgAnswerMs: 0,
    }));

  if (createList.length) {
    await prisma.reviewCard.createMany({ data: createList });
  }

  res.json({ created: createList.length });
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
      dueAt: new Date(),
      seen: 0,
      correct: 0,
      wrong: 0,
      lastAnswerMs: 0,
      avgAnswerMs: 0,
    }));

  if (createList.length) {
    await prisma.reviewCard.createMany({ data: createList });
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
      dueAt: new Date(),
      seen: 0,
      correct: 0,
      wrong: 0,
      lastAnswerMs: 0,
      avgAnswerMs: 0,
    }));

  if (createList.length) {
    await prisma.reviewCard.createMany({ data: createList });
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
        dueAt: new Date(),
        seen: 0,
        correct: 0,
        wrong: 0,
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
