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
