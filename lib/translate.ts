import { cacheLife } from "next/cache";
import { generateJson } from "./gemini";
import { languageName } from "./languages";

// Cached per (texts, lang) across requests, so a repeated route is translated once.
export async function translateLines(texts: string[], lang: string): Promise<string[]> {
  "use cache";
  cacheLife("weeks");
  const out = await generateJson<{ lines: string[] }>({
    system:
      "You translate short campus navigation instructions. Keep place names, bus route names, stop names " +
      "and times exactly as written (do not translate proper nouns). Keep each line short and clear. " +
      "Return exactly one translated line per input line, in order.",
    contents: `Target language: ${languageName(lang)} (${lang}).\nLines:\n${JSON.stringify(texts)}`,
    schema: {
      type: "object",
      properties: { lines: { type: "array", items: { type: "string" } } },
      required: ["lines"],
    },
  });
  if (!Array.isArray(out.lines) || out.lines.length !== texts.length || out.lines.some(l => typeof l !== "string")) {
    throw new Error("Translation came back malformed");
  }
  return out.lines;
}
