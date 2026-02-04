-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "order" INTEGER;

-- CreateTable
CREATE TABLE "SentenceExample" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "reading" TEXT NOT NULL,
    "readingReason" TEXT,
    "romaji" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "breakdown" JSONB,
    "grammarNotes" JSONB,

    CONSTRAINT "SentenceExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "nextOrder" INTEGER NOT NULL,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SentenceExample" ADD CONSTRAINT "SentenceExample_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
