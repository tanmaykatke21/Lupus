// The agent loop: send the question to Gemini with our tools, run whatever tools it asks for,
// and stop when it calls show_answer. The answer card is then built from our stored plan,
// so every time and stop the rider sees comes from our code, not from the model.
import { clockAfter } from "../campusClock";
import type { LeaveStatus } from "../planner";
import { routeName } from "../routes";
import { runTool, TOOL_DECLARATIONS, type AgentContext, type StoredPlan } from "./tools";

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** Minimal shape of a conversation turn (matches the Gemini SDK's Content). */
export interface Turn {
  role: "user" | "model";
  parts: Record<string, unknown>[];
}

/** One model step. Wraps the Gemini SDK so tests can swap in a scripted fake. */
export interface ModelClient {
  step(input: { system: string; turns: Turn[] }): Promise<{ calls: ToolCall[]; modelTurn: Turn; text?: string }>;
}

export type Verdict = "yes" | "tight" | "no" | "info" | "need_info";

export interface AnswerCard {
  mode: "bus" | "walk";
  fromName: string;
  toName: string;
  toPlaceId: string;
  fromPlaceId: string | null;
  leaveInMin: number;
  pace: LeaveStatus | null;
  routeName: string | null;
  routeId: number | null;
  boardStop: string | null;
  busArrivesAt: string | null;
  alightStop: string | null;
  arriveAt: string;
  arriveInMin: number;
  estimated: boolean;
  deadline: string | null;
  bufferMin: number | null;
}

export interface AgentAnswer {
  verdict: Verdict;
  message: string;
  card: AnswerCard | null;
  /** Tools the model called, in order, for the "how Lupus worked this out" line and for debugging. */
  steps: string[];
}

export const MAX_STEPS = 6;
/** Under this many minutes of spare time, "yes" becomes "tight". */
const TIGHT_BUFFER_MIN = 5;

export function systemPrompt(ctx: AgentContext): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(ctx.nowMs);
  return [
    "You are Lupus, the Stony Brook University campus bus assistant.",
    `Current campus time: ${day} ${clockAfter(ctx.nowMs, 0)} (America/New_York).`,
    ctx.current
      ? `The rider's current location is known ("${ctx.current.label}"); use from_place_id "current_location" when they don't name a start.`
      : "The rider's current location is unknown. If they don't say where they're starting, call show_answer with verdict need_info and ask.",
    "Use tools for every fact: find_place to turn names into place ids, plan_trip for trips and times, bus_status and stop_departures for live buses.",
    "Never invent times, routes, stops or distances. Only use numbers that tools returned.",
    "Turn times like 'at 2' or 'by 2pm' into arrive_by in 24-hour HH:MM, choosing the next upcoming occurrence today.",
    "For 'will I make it' questions answer yes, tight or no using buffer_min_with_best from plan_trip.",
    "If a place is ambiguous, pick the best find_place match rather than asking, unless nothing matches.",
    "Always finish by calling show_answer exactly once with one or two short sentences. Include plan_id when the answer is about a trip.",
  ].join("\n");
}

function verdictFor(stored: StoredPlan, arriveInMin: number): Verdict | null {
  if (stored.deadlineInMin === null) return null;
  const buffer = stored.deadlineInMin - arriveInMin;
  if (buffer < 0) return "no";
  return buffer < TIGHT_BUFFER_MIN ? "tight" : "yes";
}

export function buildCard(stored: StoredPlan, network: AgentContext["network"], nowMs: number): AnswerCard {
  const { plan } = stored;
  const top = plan.best === "bus" ? plan.options[0] : null;
  const arriveInMin = top ? top.arriveInMin : plan.walkMin;
  return {
    mode: top ? "bus" : "walk",
    fromName: stored.from.name,
    toName: stored.to.name,
    toPlaceId: stored.to.id,
    fromPlaceId: stored.from.id,
    leaveInMin: top ? top.leaveInMin : 0,
    pace: top ? top.status : null,
    routeName: top ? routeName(top.routeId, network) : null,
    routeId: top ? top.routeId : null,
    boardStop: top ? top.board.stop.name : null,
    busArrivesAt: top ? clockAfter(nowMs, top.boardInMin) : null,
    alightStop: top ? top.alight.stop.name : null,
    arriveAt: clockAfter(nowMs, arriveInMin),
    arriveInMin,
    estimated: top ? top.estimated : false,
    deadline: stored.deadlineLabel,
    bufferMin: stored.deadlineInMin === null ? null : stored.deadlineInMin - arriveInMin,
  };
}

export async function runAgent(
  question: string,
  ctx: AgentContext,
  model: ModelClient,
  history: Turn[] = [],
): Promise<AgentAnswer> {
  const system = systemPrompt(ctx);
  const turns: Turn[] = [...history, { role: "user", parts: [{ text: question }] }];
  const steps: string[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const { calls, modelTurn, text } = await model.step({ system, turns });
    if (calls.length === 0) {
      // The model is configured to always call a tool; if it answers in plain text anyway, show that text.
      return { verdict: "info", message: (text ?? "").trim() || "Sorry, I couldn't work that out. Try rephrasing.", card: null, steps };
    }
    turns.push(modelTurn);

    const finish = calls.find((c) => c.name === "show_answer");
    if (finish) {
      steps.push("show_answer");
      const planId = typeof finish.args.plan_id === "string" ? finish.args.plan_id : null;
      // Fall back to the latest plan if the model forgot to name one.
      const stored = (planId && ctx.plans.get(planId)) || [...ctx.plans.values()].at(-1) || null;
      let verdict = (finish.args.verdict as Verdict) ?? "info";
      const card = stored ? buildCard(stored, ctx.network, ctx.nowMs) : null;
      // Our arithmetic decides yes / tight / no, even if the model's wording leaned the other way.
      if (stored && card) verdict = verdictFor(stored, card.arriveInMin) ?? verdict;
      return { verdict, message: String(finish.args.message ?? "").trim(), card, steps };
    }

    const responses = calls.map((c) => {
      steps.push(c.name);
      let response: Record<string, unknown>;
      try {
        response = runTool(c.name, c.args ?? {}, ctx);
      } catch (err) {
        response = { error: err instanceof Error ? err.message : "Tool failed" };
      }
      return { functionResponse: { ...(c.id && { id: c.id }), name: c.name, response } };
    });
    turns.push({ role: "user", parts: responses });
  }

  return {
    verdict: "info",
    message: "That took too many steps to work out. Try asking with a start and a destination.",
    card: null,
    steps,
  };
}

export { TOOL_DECLARATIONS };
