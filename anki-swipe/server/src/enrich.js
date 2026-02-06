import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a Japanese tutor. Return ONLY valid JSON that matches the requested shape. 
Use ONE target kanji per sentence. Keep sentences beginner-friendly.`;

const buildUserPrompt = (card, level) => `
Target Kanji: ${card.script}
Meaning: ${card.meaning ?? ""}
Onyomi: ${card.onyomi ?? ""}
Kunyomi: ${card.kunyomi ?? ""}
JLPT Level: ${level ?? "unknown"}

Return JSON with:
{
  "sentence": "...",
  "reading": "...",
  "readingReason": "...",
  "readingUsed": "...", 
  "romaji": "...",
  "translation": "...",
  "breakdown": [{"jp":"...","romaji":"...","meaning":"..."}],
  "grammarNotes": ["..."],
  "difficultyScore": 1-5,
  "difficultyNotes": "..."
}
`;

const parseJSON = (text) => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty response");
  return JSON.parse(trimmed);
};

const toHiragana = (text = "") =>
  text.replace(/[ァ-ン]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const normalizeReading = (text = "") =>
  toHiragana(text)
    .replace(/[.\-]/g, "")
    .replace(/\s+/g, "")
    .trim();

const splitReadings = (text = "") =>
  text
    .split(/[,/]/)
    .map((part) => normalizeReading(part))
    .filter(Boolean);

const isReadingAllowed = (readingUsed, card) => {
  if (!readingUsed) return false;
  const onyomi = splitReadings(card.onyomi || "");
  const kunyomi = splitReadings(card.kunyomi || "");
  const allowed = new Set([...onyomi, ...kunyomi]);
  return allowed.has(normalizeReading(readingUsed));
};

export const generateEnrichment = async (card, level) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(card, level) },
    ],
  });

  const outputText = response.output_text ?? "";
  const payload = parseJSON(outputText);

  if (!isReadingAllowed(payload.readingUsed, card)) {
    payload.readingReason =
      "This word has a special reading in this sentence (jukujikun). Learn it as vocabulary.";
  }

  return {
    sentence: payload.sentence,
    reading: payload.reading,
    readingReason: payload.readingReason ?? null,
    romaji: payload.romaji,
    translation: payload.translation,
    breakdown: payload.breakdown ?? null,
    grammarNotes: payload.grammarNotes ?? null,
    difficultyScore:
      typeof payload.difficultyScore === "number" ? payload.difficultyScore : null,
    difficultyNotes: payload.difficultyNotes ?? null,
    model: response.model ?? null,
  };
};
