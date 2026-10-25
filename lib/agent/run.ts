// The agent loop: Gemini picks tools, we run them, and it finishes with show_answer. The answer card
// is built from our stored plan, so every time and stop the rider sees comes from our code.
// Adapted from Tanmay's agent.
import { formatClock } from "../time";
import type { RouteOption } from "../router";
import { runTool, type AgentContext, type StoredPlan } from "./tools";

export interface ToolCall { id?: string; name: string; args: Record<string, unknown> }
export interface Turn { role: "user" | "model"; parts: Record<string, unknown>[] }

/** One model step. Wraps the Gemini SDK so tests can swap in a scripted fake. */
export interface ModelClient {
  step(input: { system: string; turns: Turn[] }): Promise<{ calls: ToolCall[]; modelTurn: Turn; text?: string }>;
}

export type Verdict = "yes" | "tight" | "no" | "info" | "need_info";

export interface AnswerCard {
  planId: string;
  fromName: string;
  from: { lat: number; lng: number; placeId: string | null };
  toName: string;
  toPlaceId: string;
  kind: "bus" | "walk";
  leaveBy: string;
  slackMin: number;
  route: string | null;
  boardStop: string | null;
  busAt: string | null;
  alightStop: string | null;
  arriveAt: string;
  deadline: string | null;
  deadlineMs: number | null;
  bufferMin: number | null;
  context: string | null;
}

export interface AgentAnswer { verdict: Verdict; message: string; card: AnswerCard | null; steps: string[] }

export const MAX_STEPS = 6;
/** Under this many minutes of spare time, "yes" becomes "tight". */
const TIGHT_BUFFER_MIN = 5;

export function systemPrompt(ctx: AgentContext) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(ctx.nowMs);
  return [
    "You are Lupus, the Stony Brook University campus transit conductor: helpful, brief, a touch of steam-era charm.",
    `Current campus time: ${day} ${formatClock(ctx.nowMs)} (America/New_York).`,
    ctx.current
      ? `The rider's location is known ("${ctx.current.label}"); use from_place_id "current_location" when they don't name a start.`
      : "The rider's location is unknown. If they don't say where they're starting, call show_answer with verdict need_info and ask.",
    "Use tools for every fact: find_place for place ids, plan_trip for trips, lirr_departures and catch_train for LIRR trains, bus_status and stop_departures for live buses.",
    "Never invent times, routes, stops or distances. Only use numbers that tools returned.",
    "Turn times like 'at 2' or 'by 2pm' into arrive_by in 24-hour HH:MM, choosing the next upcoming occurrence.",
    "'The city', 'NYC', 'Penn', 'Manhattan' mean a westbound LIRR train.",
    "For 'will I make it' questions answer yes, tight or no using buffer_min_with_best.",
    "If a place is ambiguous, pick the best find_place match rather than asking, unless nothing matches.",
    "Always finish by calling show_answer exactly once with one or two short sentences, including plan_id when it's about a trip.",
  ].join("\n");
}

function best(stored: StoredPlan): RouteOption {
  return stored.options[0];
}

export function buildCard(stored: StoredPlan, nowMs: number): AnswerCard {
  const o = best(stored);
  const bus = o.legs.find(l => l.type === "bus");
  return {
    planId: stored.id,
    fromName: stored.from.name,
    from: { lat: stored.from.lat, lng: stored.from.lng, placeId: stored.from.placeId },
    toName: stored.to.name,
    toPlaceId: stored.to.id,
    kind: o.kind,
    leaveBy: formatClock(Math.max(nowMs, o.leaveBy)),
    slackMin: Math.round((o.leaveBy - nowMs) / 60_000),
    route: bus?.type === "bus" ? bus.routeName : null,
    boardStop: bus?.type === "bus" ? bus.boardStopName : null,
    busAt: bus?.type === "bus" ? formatClock(bus.departAt) : null,
    alightStop: bus?.type === "bus" ? bus.alightStopName : null,
    arriveAt: formatClock(o.arriveAt),
    deadline: stored.deadline === null ? null : formatClock(stored.deadline),
    deadlineMs: stored.deadline,
    bufferMin: stored.deadline === null ? null : Math.round((stored.deadline - stored.earliestArrival) / 60_000),
    context: stored.context,
  };
}

/** Our arithmetic decides yes / tight / no, whatever the model's wording leaned toward. */
export function verdictFor(card: AnswerCard): Verdict | null {
  if (card.bufferMin === null) return null;
  if (card.bufferMin < 0) return "no";
  return card.bufferMin < TIGHT_BUFFER_MIN ? "tight" : "yes";
}

export async function runAgent(question: string, ctx: AgentContext, model: ModelClient, history: Turn[] = []): Promise<AgentAnswer> {
  const system = systemPrompt(ctx);
  const turns: Turn[] = [...history, { role: "user", parts: [{ text: question }] }];
  const steps: string[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const { calls, modelTurn, text } = await model.step({ system, turns });
    if (!calls.length) {
      return { verdict: "info", message: (text ?? "").trim() || "Sorry, I couldn't work that out. Try rephrasing.", card: null, steps };
    }
    turns.push(modelTurn);

    const finish = calls.find(c => c.name === "show_answer");
    if (finish) {
      steps.push("show_answer");
      const planId = typeof finish.args.plan_id === "string" ? finish.args.plan_id : null;
      const stored = (planId && ctx.plans.get(planId)) || [...ctx.plans.values()].at(-1) || null;
      const card = stored ? buildCard(stored, ctx.nowMs) : null;
      const verdict = (card && verdictFor(card)) || ((finish.args.verdict as Verdict) ?? "info");
      return { verdict, message: String(finish.args.message ?? "").trim(), card, steps };
    }

    const responses = await Promise.all(calls.map(async c => {
      steps.push(c.name);
      let response: Record<string, unknown>;
      try {
        response = await runTool(c.name, c.args ?? {}, ctx);
      } catch (err) {
        response = { error: err instanceof Error ? err.message : "Tool failed" };
      }
      return { functionResponse: { ...(c.id && { id: c.id }), name: c.name, response } };
    }));
    turns.push({ role: "user", parts: responses });
  }
  return { verdict: "info", message: "That took too many steps. Try asking with a start and a destination.", card: null, steps };
}
