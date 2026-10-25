import { connection } from "next/server";
import schedule from "@/data/lirr-stony-brook.json";
import { geminiClient } from "@/lib/agent/gemini";
import { mockClient } from "@/lib/agent/mock";
import { runAgent, type Turn } from "@/lib/agent/run";
import type { AgentContext } from "@/lib/agent/tools";
import { geminiConfigured } from "@/lib/gemini";
import { CACHE, json, rateLimit } from "@/lib/http";
import { upcomingTrains, type LirrSchedule } from "@/lib/lirr";
import { cachedBuses, cachedLirrRealtime, cachedRoutes, cachedStopEtas, cachedStops } from "@/lib/network";
import { planTrip } from "@/lib/planner";

const MAX_QUESTION = 400;

interface Body {
  question?: unknown;
  current?: { lat?: unknown; lng?: unknown; label?: unknown } | null;
  previous?: { question?: unknown; answer?: unknown } | null;
  accessible?: unknown;
}

// POST /api/agent { question, current?, previous? } → { verdict, message, card, steps, mode }
export async function POST(request: Request) {
  await connection();
  // Each question costs several Gemini calls.
  const limited = rateLimit(request, 12);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Body | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return json({ error: "Ask a question, like: I'm at West Apartments, lab in Life Sciences at 2. Will I make it?" }, CACHE.none, 400);
  if (question.length > MAX_QUESTION) return json({ error: `Keep questions under ${MAX_QUESTION} characters.` }, CACHE.none, 400);

  const mode = process.env.AGENT_MODE === "mock" || !geminiConfigured() ? "mock" : "gemini";
  const c = body?.current;
  const current = c && typeof c.lat === "number" && typeof c.lng === "number" && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    ? { lat: c.lat, lng: c.lng, label: typeof c.label === "string" ? c.label.slice(0, 60) : "Your location" }
    : null;

  const now = Date.now();
  const [routes, stops, buses, rt] = await Promise.all([
    cachedRoutes().catch(() => []), cachedStops().catch(() => []), cachedBuses().catch(() => []), cachedLirrRealtime().catch(() => null),
  ]);
  const ctx: AgentContext = {
    nowMs: now,
    current,
    routes,
    stops,
    buses,
    plan: async (from, to, arriveBy) => (await planTrip({
      from, to, time: new Date(now), arriveBy: arriveBy ? new Date(arriveBy) : undefined, accessible: body?.accessible === true,
    })).options,
    stopEtas: id => cachedStopEtas(id),
    trains: (direction, after) => upcomingTrains(schedule as LirrSchedule, rt, { now: after, kind: "departures", direction, limit: 6, windowMin: 18 * 60 })
      .filter(t => !t.canceled),
    plans: new Map(),
  };

  const history: Turn[] = [];
  const prev = body?.previous;
  if (prev && typeof prev.question === "string" && typeof prev.answer === "string") {
    history.push(
      { role: "user", parts: [{ text: prev.question.slice(0, MAX_QUESTION) }] },
      { role: "model", parts: [{ text: prev.answer.slice(0, 600) }] },
    );
  }

  try {
    const model = mode === "mock" ? mockClient(!!current) : geminiClient();
    const answer = await runAgent(question, ctx, model, history);
    return json({ ...answer, mode }, CACHE.none);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[agent] failed:", msg);
    if (/API key|PERMISSION|401|403/i.test(msg)) return json({ error: "Gemini rejected the API key." }, CACHE.none, 502);
    if (/quota|429|RESOURCE_EXHAUSTED|UNAVAILABLE|503|504|DEADLINE/i.test(msg)) {
      return json({ error: "Lupus is busy right now (Gemini is overloaded). Try again in a moment." }, CACHE.none, 503);
    }
    return json({ error: "Couldn't reach Gemini. Try again." }, CACHE.none, 502);
  }
}
