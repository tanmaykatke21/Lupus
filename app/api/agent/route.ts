import { geminiClient } from "@/lib/agent/gemini";
import { mockClient } from "@/lib/agent/mock";
import { runAgent, type Turn } from "@/lib/agent/run";
import type { AgentContext } from "@/lib/agent/tools";
import { getBusFeed, getNetwork } from "@/lib/etaspot";
import { walkBetween } from "@/lib/walkService";
import { searchablePlaces } from "@/lib/places";

const MAX_QUESTION = 400;
// Each question costs Gemini calls, so limit how often one visitor can ask.
const LIMIT = 12;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

interface Body {
  question?: unknown;
  current?: { lat?: unknown; lng?: unknown; label?: unknown } | null;
  /** The previous question and answer, so a follow-up like "from SAC" has context. */
  previous?: { question?: unknown; answer?: unknown } | null;
}

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

// POST /api/agent { question, current?, previous? } → { verdict, message, card, steps, mode }
export async function POST(request: Request) {
  const now = Date.now();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (rateLimited(ip, now)) return fail(429, "Too many questions in a minute. Wait a moment and ask again.");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail(400, "Send JSON with a question.");
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return fail(400, "Ask a question, like: I'm at West Apartments, lab in Life Sciences at 2. Will I make it?");
  if (question.length > MAX_QUESTION) return fail(400, `Keep questions under ${MAX_QUESTION} characters.`);

  const mode = process.env.AGENT_MODE === "mock" ? "mock" : "gemini";
  const apiKey = process.env.GEMINI_API_KEY;
  if (mode === "gemini" && !apiKey) {
    return fail(503, "Ask Lupus needs a Gemini API key. Add GEMINI_API_KEY to .env and restart the app.");
  }

  const [network, feed] = await Promise.all([getNetwork(now), getBusFeed(now)]);
  const c = body.current;
  const current =
    c && typeof c.lat === "number" && typeof c.lng === "number" && Number.isFinite(c.lat) && Number.isFinite(c.lng)
      ? { lat: c.lat, lng: c.lng, label: typeof c.label === "string" ? c.label.slice(0, 60) : "Your location" }
      : null;
  const places = searchablePlaces(network);
  const ctx: AgentContext = {
    network,
    buses: feed.buses,
    places,
    current,
    nowMs: feed.asOf,
    plans: new Map(),
    walkMeters: (from, to) => {
      const walk = walkBetween(from, to);
      return walk.source === "paths" ? walk.meters : null;
    },
  };

  const history: Turn[] = [];
  const prev = body.previous;
  if (prev && typeof prev.question === "string" && typeof prev.answer === "string") {
    history.push(
      { role: "user", parts: [{ text: prev.question.slice(0, MAX_QUESTION) }] },
      { role: "model", parts: [{ text: prev.answer.slice(0, 600) }] },
    );
  }

  try {
    const model = mode === "mock" ? mockClient(places, Boolean(current)) : geminiClient(apiKey!);
    const answer = await runAgent(question, ctx, model, history);
    return Response.json({ ...answer, mode, dataSource: feed.source });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[agent] failed:", msg);
    if (/API key|PERMISSION|401|403/i.test(msg)) return fail(502, "Gemini rejected the API key. Check GEMINI_API_KEY in .env.");
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) return fail(503, "Gemini's free quota is used up for now. Try again in a minute.");
    if (/not found|404/i.test(msg)) return fail(502, "Gemini doesn't recognize the model name. Set GEMINI_MODEL in .env to a current model.");
    return fail(502, "Couldn't reach Gemini. Check your connection and try again.");
  }
}
