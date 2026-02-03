import { PrismaClient } from "@prisma/client";
import { DECKS } from "../../src/data/japanese.js";

const prisma = new PrismaClient();

const seed = async () => {
  await prisma.reviewCard.deleteMany();
  await prisma.card.deleteMany();
  await prisma.group.deleteMany();
  await prisma.deck.deleteMany();

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
          },
        });
      }
    }
  }
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
