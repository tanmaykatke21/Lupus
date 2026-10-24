import { connection } from "next/server";
import { geminiConfigured } from "@/lib/gemini";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";
import { isLang } from "@/lib/languages";
import { translateLines } from "@/lib/translate";

// POST { texts: string[], lang: "es" } → { lines: string[] }
export async function POST(request: Request) {
  await connection();
  const limited = rateLimit(request, 30);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const texts = body?.texts;
  const lang = body?.lang;
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 20 || texts.some((t: unknown) => typeof t !== "string" || t.length > 300)) {
    return json({ error: "texts must be 1-20 strings of up to 300 chars" }, CACHE.none, 400);
  }
  if (typeof lang !== "string" || !isLang(lang)) return json({ error: "unsupported lang" }, CACHE.none, 400);
  if (lang === "en") return json({ lines: texts }, CACHE.none);
  if (!geminiConfigured()) return json({ error: "Translation is not configured" }, CACHE.none, 503);
  try {
    return json({ lines: await translateLines(texts, lang) }, CACHE.none);
  } catch (err) {
    return errorJson(err);
  }
}
