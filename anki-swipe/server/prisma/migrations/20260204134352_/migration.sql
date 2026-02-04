-- CreateTable
CREATE TABLE "KanjiEnrichment" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentence" TEXT NOT NULL,
    "reading" TEXT NOT NULL,
    "readingReason" TEXT,
    "romaji" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "breakdown" JSONB,
    "grammarNotes" JSONB,
    "difficultyScore" INTEGER,
    "difficultyNotes" TEXT,

    CONSTRAINT "KanjiEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KanjiEnrichment_cardId_key" ON "KanjiEnrichment"("cardId");

-- AddForeignKey
ALTER TABLE "KanjiEnrichment" ADD CONSTRAINT "KanjiEnrichment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
