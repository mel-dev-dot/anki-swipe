import { PrismaClient } from "@prisma/client";
import { DECKS } from "../../src/data/japanese.js";

const prisma = new PrismaClient();

const seed = async () => {
  await prisma.reviewCard.deleteMany();
  await prisma.sentenceExample.deleteMany();
  await prisma.learningProgress.deleteMany();
  await prisma.card.deleteMany();
  await prisma.group.deleteMany();
  await prisma.deck.deleteMany();

  let kanjiOrderCounter = 0;

  for (const deck of DECKS) {
    await prisma.deck.create({
      data: {
        id: deck.id,
        label: deck.label,
      },
    });

    for (const group of deck.groups) {
      await prisma.group.create({
        data: {
          id: `${deck.id}-${group.id}`,
          key: group.id,
          label: group.label,
          deckId: deck.id,
        },
      });

      for (const card of group.cards) {
        let resolvedOrder = null;
        if (deck.id === "kanji") {
          if (typeof card.order === "number") {
            resolvedOrder = card.order;
            kanjiOrderCounter = Math.max(kanjiOrderCounter, card.order + 1);
          } else {
            resolvedOrder = kanjiOrderCounter;
            kanjiOrderCounter += 1;
          }
        }

        await prisma.card.create({
          data: {
            id: card.id,
            deckId: deck.id,
            groupId: `${deck.id}-${group.id}`,
            groupKey: group.id,
            script: card.script,
            romaji: card.romaji ?? null,
            meaning: card.meaning ?? null,
            onyomi: card.onyomi ?? null,
            kunyomi: card.kunyomi ?? null,
            level: deck.id === "kanji" ? group.id : null,
            order: resolvedOrder,
          },
        });

        if (card.example) {
          await prisma.sentenceExample.create({
            data: {
              id: `${card.id}-ex-1`,
              cardId: card.id,
              sentence: card.example.sentence,
              reading: card.example.reading,
              readingReason: card.example.readingReason ?? null,
              romaji: card.example.romaji,
              translation: card.example.translation,
              breakdown: card.example.breakdown ?? null,
              grammarNotes: card.example.grammarNotes ?? null,
            },
          });
        }
      }
    }
  }

  await prisma.learningProgress.create({
    data: {
      id: "default",
      nextOrder: 0,
    },
  });
};

seed()
  .then(() => {
    console.log("Seed complete");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
