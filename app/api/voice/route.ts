import { connection } from "next/server";
import { CACHE, json, rateLimit } from "@/lib/http";
import { isLang } from "@/lib/languages";
import { voiceHash } from "@/lib/voiceHash";

const MAX_CHARS = 400;
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

// GET /api/voice?lang=en&v=1&h=<hash>&text=... → audio/mpeg
// The URL is deterministic for (text, lang, voice version), and the response is cached by the
// CDN for a year, so replaying an instruction never spends ElevenLabs credits twice.
export async function GET(request: Request) {
  await connection();
  const q = new URL(request.url).searchParams;
  const text = (q.get("text") ?? "").trim();
  const lang = q.get("lang") ?? "en";
  const v = q.get("v") ?? "1";
  if (!text || text.length > MAX_CHARS) return json({ error: `text must be 1-${MAX_CHARS} chars` }, CACHE.none, 400);
  if (!isLang(lang)) return json({ error: "unsupported lang" }, CACHE.none, 400);
  if (q.get("h") !== await voiceHash(text, lang, v)) return json({ error: "bad hash" }, CACHE.none, 400);

  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return json({ error: "Voice is not configured" }, CACHE.none, 503);
  const limited = rateLimit(request, 30);
  if (limited) return limited;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      language_code: MODEL.includes("multilingual") ? undefined : lang,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.35 },
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(err => err as Error);
  if (res instanceof Error || !res.ok) {
    const detail = res instanceof Error ? res.message : `${res.status} ${await res.text().catch(() => "")}`.slice(0, 200);
    console.error("[voice] ElevenLabs failed:", detail);
    return json({ error: "Voice service failed" }, CACHE.none, 502);
  }
  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  });
}
