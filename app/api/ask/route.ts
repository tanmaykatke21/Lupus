import { connection } from "next/server";
import { ask, type AskClass } from "@/lib/ask";
import { geminiConfigured } from "@/lib/gemini";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";
import { cachedLirrRealtime } from "@/lib/network";

// POST { q: string, classes?: { id, course, title }[] } → { action }
export async function POST(request: Request) {
  await connection();
  const limited = rateLimit(request, 20);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 300) : "";
  if (!q) return json({ error: "q is required" }, CACHE.none, 400);
  const classes: AskClass[] = Array.isArray(body?.classes)
    ? body.classes
        .filter((c: AskClass) => typeof c?.id === "string" && typeof c?.course === "string")
        .slice(0, 20)
        .map((c: AskClass) => ({ id: c.id.slice(0, 40), course: c.course.slice(0, 40), title: typeof c.title === "string" ? c.title.slice(0, 80) : undefined }))
    : [];
  if (!geminiConfigured()) return json({ error: "Ask is not configured" }, CACHE.none, 503);
  try {
    const rt = await cachedLirrRealtime().catch(() => null);
    return json({ action: await ask(q, classes, Date.now(), rt) }, CACHE.none);
  } catch (err) {
    // Gemini overloaded on every model: answer politely so the app can suggest search instead.
    if (/UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|"code":\s*(429|503|504)|abort/i.test(String((err as Error)?.message))) {
      return json({ action: { type: "none", reply: "The conductor is swamped right now. Try searching for a place instead." } }, CACHE.none);
    }
    return errorJson(err);
  }
}
