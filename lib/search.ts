import type { Place } from "./places";

export interface SearchHit {
  place: Place;
  score: number;
  /** The name or nickname that matched, so the UI can show "Javits (Lecture Center)". */
  matched: string;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Words that don't help tell places apart.
const STOP = new Set(["the", "of", "for", "and", "building", "center", "hall"]);

function initials(text: string): string {
  return text
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map((w) => w[0])
    .join("");
}

/** Edit distance with adjacent swaps, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How well one name or nickname matches the query (0 = no match). */
function scoreText(query: string, text: string, isAlias: boolean): number {
  const t = normalize(text);
  if (!t) return 0;
  if (t === query) return isAlias ? 98 : 100;
  if (t.startsWith(query)) return 85;
  const words = t.split(" ");
  if (words.some((w) => w.startsWith(query))) return 75;

  const qTokens = query.split(" ");
  if (qTokens.length > 1 && qTokens.every((q) => words.some((w) => w.startsWith(q)))) return 70;
  if (query.length >= 2 && !query.includes(" ") && initials(t) === query) return 65;
  if (query.length >= 3 && t.includes(query)) return 50;

  // Typos: every query word is close to some word in the name.
  const typoOk = qTokens.every((q) => {
    if (q.length < 4) return words.some((w) => w.startsWith(q));
    const allowed = q.length >= 7 ? 2 : 1;
    return words.some((w) => editDistance(q, w.slice(0, Math.max(q.length, w.length)), allowed) <= allowed ||
      editDistance(q, w.slice(0, q.length), allowed) <= allowed);
  });
  return typoOk ? 35 : 0;
}

export function searchPlaces(places: Place[], rawQuery: string, limit = 6): SearchHit[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  const hits: SearchHit[] = [];
  for (const place of places) {
    let best: SearchHit | null = null;
    for (const [text, isAlias] of [[place.name, false], ...place.aliases.map((a) => [a, true] as const)] as const) {
      const score = scoreText(query, text, isAlias);
      if (score > (best?.score ?? 0)) best = { place, score, matched: text };
    }
    if (best) hits.push(best);
  }
  return hits
    .sort((a, b) => b.score - a.score || a.place.name.length - b.place.name.length)
    .slice(0, limit);
}
