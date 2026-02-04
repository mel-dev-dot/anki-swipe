import fs from "fs";
import path from "path";

const DEFAULT_PATH = path.resolve(process.cwd(), "data", "kradfile");

let cachedMap = null;
let cachedAt = 0;

const parseKradFile = (contents) => {
  const lines = contents.split("\n");
  const map = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [kanjiPart, componentsPart] = line.split(" : ");
    if (!kanjiPart || !componentsPart) continue;
    const kanji = kanjiPart.trim();
    const components = componentsPart
      .trim()
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!kanji || components.length === 0) continue;
    map.set(kanji, components);
  }

  return map;
};

const loadKrad = (filePath) => {
  const target = filePath || process.env.KRADFILE_PATH || DEFAULT_PATH;
  if (!fs.existsSync(target)) return null;
  const contents = fs.readFileSync(target, "utf8");
  return parseKradFile(contents);
};

export const getKanjiComponentMap = () => {
  if (cachedMap) return cachedMap;
  const map = loadKrad();
  cachedMap = map;
  cachedAt = Date.now();
  return map;
};

export const getRelatedKanji = (kanji, allKanji) => {
  const map = getKanjiComponentMap();
  if (!map || !kanji) return [];
  const components = map.get(kanji);
  if (!components || components.length === 0) return [];

  const related = [];
  for (const candidate of allKanji) {
    if (candidate === kanji) continue;
    const candidateComponents = map.get(candidate);
    if (!candidateComponents) continue;
    const overlap = candidateComponents.filter((item) => components.includes(item));
    if (overlap.length >= 1) {
      related.push({ kanji: candidate, overlap });
    }
  }

  return related;
};
