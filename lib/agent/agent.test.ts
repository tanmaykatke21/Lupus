import { describe, expect, it } from "vitest";
import type { RouteOption } from "../router";
import { deadlineIn, mockClient } from "./mock";
import { runAgent, type ModelClient, type ToolCall } from "./run";
import { deadlineFrom, type AgentContext } from "./tools";

const NOW = Date.parse("2026-10-21T17:30:00Z"); // Wed 1:30 PM ET

function walkOption(minutes: number): RouteOption {
  return {
    id: "walk", kind: "walk", leaveBy: NOW, arriveAt: NOW + minutes * 60_000, slackMinutes: null, totalMinutes: minutes,
    breakdown: { walk: minutes, wait: 0, ride: 0 }, estimated: false,
    legs: [{ type: "walk", meters: minutes * 78, seconds: minutes * 60, coords: [], shortcuts: [], stairs: false, toLabel: "your destination" }],
  };
}

const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({
  nowMs: NOW, current: { lat: 40.9117, lng: -73.131, label: "Greeley Hall" },
  routes: [], stops: [], buses: [],
  plan: async () => [walkOption(20)],
  stopEtas: async () => [], trains: () => [], plans: new Map(), ...over,
});

/** A fake Gemini that replays scripted tool calls, one step at a time. */
function scripted(...steps: ToolCall[][]): ModelClient {
  let i = 0;
  return { async step() { const calls = steps[i++] ?? []; return { calls, modelTurn: { role: "model", parts: calls.map(c => ({ functionCall: c })) } }; } };
}

describe("runAgent", () => {
  it("lets our arithmetic decide the verdict, not the model's wording", async () => {
    // 20 min walk, class at 2:00 → 10 min buffer, but the model claims "no".
    const model = scripted(
      [{ name: "plan_trip", args: { from_place_id: "current_location", to_place_id: "javits", arrive_by: "14:00" } }],
      [{ name: "show_answer", args: { verdict: "no", message: "You won't make it.", plan_id: "plan1" } }],
    );
    const a = await runAgent("will I make it to javits by 2", ctx(), model);
    expect(a.verdict).toBe("yes");
    expect(a.card).toMatchObject({ toPlaceId: "javits", kind: "walk", bufferMin: 10 });
    expect(a.steps).toEqual(["plan_trip", "show_answer"]);
  });

  it("says tight under 5 minutes of buffer and no when late", async () => {
    const run = (walkMin: number) => runAgent("q", ctx({ plan: async () => [walkOption(walkMin)] }), scripted(
      [{ name: "plan_trip", args: { from_place_id: "current_location", to_place_id: "javits", arrive_by: "14:00" } }],
      [{ name: "show_answer", args: { verdict: "info", message: "ok", plan_id: "plan1" } }],
    ));
    expect((await run(27)).verdict).toBe("tight");
    expect((await run(35)).verdict).toBe("no");
  });

  it("returns tool errors to the model instead of crashing, e.g. unknown places", async () => {
    const a = await runAgent("q", ctx(), scripted(
      [{ name: "plan_trip", args: { from_place_id: "current_location", to_place_id: "hogwarts" } }],
      [{ name: "show_answer", args: { verdict: "need_info", message: "Which building?" } }],
    ));
    expect(a).toMatchObject({ verdict: "need_info", card: null });
  });

  it("asks where you're starting when location is unknown", async () => {
    const a = await runAgent("to javits", ctx({ current: null }), mockClient(false));
    expect(a.verdict).toBe("need_info");
    expect(a.message).toMatch(/starting from/i);
  });
});

describe("buffer", () => {
  it("measures 'will I make it' from leaving now, not from the latest departure that still makes it", async () => {
    // Arrive-by planning returns a trip ending exactly at the deadline; leaving now arrives 10 min early.
    const plan: AgentContext["plan"] = async (_f, _t, arriveBy) => {
      const o = walkOption(20);
      return arriveBy ? [{ ...o, leaveBy: arriveBy - 20 * 60_000, arriveAt: arriveBy }] : [o];
    };
    const a = await runAgent("q", ctx({ plan }), scripted(
      [{ name: "plan_trip", args: { from_place_id: "current_location", to_place_id: "javits", arrive_by: "14:00" } }],
      [{ name: "show_answer", args: { verdict: "info", message: "ok", plan_id: "plan1" } }],
    ));
    expect(a.card?.bufferMin).toBe(10);
    expect(a.verdict).toBe("yes");
  });
});

describe("mock agent", () => {
  it("plans from a named start to a named place with a deadline", async () => {
    const calls: unknown[][] = [];
    const a = await runAgent("I'm at West Apartments, lab in Javits at 2. Will I make it?",
      ctx({ plan: async (...args) => { calls.push(args); return [walkOption(20)]; } }), mockClient(true));
    expect(a.card?.toPlaceId).toBe("javits");
    expect(a.card?.fromName).toBe("West Apartments");
    expect(calls.map(c => c[2])).toContain(deadlineFrom("14:00", NOW)); // arrive-by plan (plus a leave-now one)
    expect(a.verdict).toBe("yes");
  });

  it("reads deadlines the way students say them", () => {
    expect(deadlineIn("lab at 2")).toBe("14:00");
    expect(deadlineIn("by 9:30am")).toBe("09:30");
    expect(deadlineIn("before 11")).toBe("11:00");
  });
});
