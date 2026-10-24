import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeVehicles, type RawVehicle } from "../etaspot";
import { buildNetwork, type RawRoute, type RawStop } from "../network";
import { searchablePlaces } from "../places";
import { runAgent, type ModelClient, type ToolCall, type Turn } from "./run";
import { deadlineFrom, runTool, type AgentContext } from "./tools";

// Real data from Sat Oct 24 2026 around 2:30 PM EDT, and the OpenStreetMap-located campus places.
const json = (...p: string[]) => JSON.parse(readFileSync(path.join(__dirname, "..", "..", ...p), "utf8"));
const network = buildNetwork(
  json("data", "samples", "routes-1430.json").get_routes as RawRoute[],
  json("data", "samples", "stops-1430.json").get_stops as RawStop[],
  "saved",
);
const T = 1792866654000; // 2:30:54 PM EDT
const buses = normalizeVehicles(json("data", "samples", "vehicles-1430-eta.json").get_vehicles as RawVehicle[], T);
// The app searches campus places and bus stops together; so does the agent.
const places = searchablePlaces(network);

const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({
  network,
  buses,
  places,
  current: null,
  nowMs: T,
  plans: new Map(),
  ...over,
});

/** A fake Gemini that plays back a fixed script of tool calls, recording what it was sent. */
function scripted(script: ToolCall[][]): ModelClient & { seen: Turn[][] } {
  let i = 0;
  const seen: Turn[][] = [];
  return {
    seen,
    async step({ turns }) {
      seen.push(structuredClone(turns));
      const calls = script[Math.min(i++, script.length - 1)];
      return { calls, modelTurn: { role: "model", parts: calls.map((c) => ({ functionCall: c })) } };
    },
  };
}

describe("tools", () => {
  it("find_place resolves nicknames to place ids", () => {
    const out = runTool("find_place", { query: "west apts" }, ctx()) as { matches: { id: string }[] };
    expect(out.matches[0].id).toBe("west-apts");
  });

  it("plan_trip returns our planner's numbers and a buffer when given a deadline", () => {
    const c = ctx();
    const out = runTool("plan_trip", { from_place_id: "stop-19", to_place_id: "life-sciences", arrive_by: "15:00" }, c);
    expect(out.plan_id).toBe("plan1");
    expect(out.deadline).toBe("3:00 PM");
    expect(typeof out.buffer_min_with_best).toBe("number");
    expect(c.plans.get("plan1")?.to.id).toBe("life-sciences");
  });

  it("plan_trip refuses to guess when the rider's location is unknown", () => {
    const out = runTool("plan_trip", { from_place_id: "current_location", to_place_id: "javits" }, ctx());
    expect(String(out.error)).toMatch(/unknown/i);
  });

  it("stop_departures lists buses due near a place, soonest first", () => {
    const out = runTool("stop_departures", { place_id: "stop-19" }, ctx()) as {
      departures: { stop: string; route: string; in_min: number }[];
    };
    // North P Lot is within 400 m too, and the Outer Loop reaches it a minute before the LIRR stop.
    expect(out.departures.map((d) => d.in_min)).toEqual([...out.departures.map((d) => d.in_min)].sort((a, b) => a - b));
    const lirr = out.departures.find((d) => d.stop === "Long Island Rail Road")!;
    expect(lirr.route).toBe("Outer Loop");
    expect(lirr.in_min).toBeCloseTo(4.1, 1);
  });

  it("reads deadlines on the campus clock", () => {
    expect(deadlineFrom("15:00", T)).toBeCloseTo(29.1, 1);
    expect(deadlineFrom("14:00", T)).toBeCloseTo(-30.9, 1); // passed within the hour: late, not tomorrow
    expect(deadlineFrom("2pm", T)).toBeNull();
  });
});

describe("runAgent", () => {
  it("answers 'will I make it' from tool results, with a card built from our plan", async () => {
    const model = scripted([
      [{ name: "find_place", args: { query: "LIRR" } }],
      [{ name: "find_place", args: { query: "Life Sciences" } }],
      [{ name: "plan_trip", args: { from_place_id: "stop-19", to_place_id: "life-sciences", arrive_by: "15:00" } }],
      [{ name: "show_answer", args: { verdict: "yes", message: "Yes, take the Outer Loop.", plan_id: "plan1" } }],
    ]);
    const answer = await runAgent("I'm at the LIRR, lab in Life Sciences at 3. Will I make it?", ctx(), model);
    expect(answer.steps).toEqual(["find_place", "find_place", "plan_trip", "show_answer"]);
    expect(answer.card?.toName).toBe("Life Sciences");
    expect(answer.card?.deadline).toBe("3:00 PM");
    expect(answer.card!.bufferMin!).toBeGreaterThan(5);
    expect(answer.verdict).toBe("yes");
    // Tool results went back to the model as function responses.
    const last = model.seen.at(-1)!;
    expect(JSON.stringify(last)).toContain("buffer_min_with_best");
  });

  it("overrides the model's verdict when the arithmetic disagrees", async () => {
    const model = scripted([
      [{ name: "plan_trip", args: { from_place_id: "stop-19", to_place_id: "life-sciences", arrive_by: "14:40" } }],
      [{ name: "show_answer", args: { verdict: "yes", message: "You'll make it.", plan_id: "plan1" } }],
    ]);
    const answer = await runAgent("LIRR to Life Sciences by 2:40?", ctx(), model);
    expect(answer.card!.bufferMin!).toBeLessThan(0);
    expect(answer.verdict).toBe("no");
  });

  it("asks where the rider is when it can't plan from their location", async () => {
    const model = scripted([
      [{ name: "plan_trip", args: { from_place_id: "current_location", to_place_id: "javits" } }],
      [{ name: "show_answer", args: { verdict: "need_info", message: "Where are you starting from?" } }],
    ]);
    const answer = await runAgent("How do I get to Javits?", ctx(), model);
    expect(answer.verdict).toBe("need_info");
    expect(answer.card).toBeNull();
  });

  it("plans from the rider's current location when the app knows it", async () => {
    const lirr = network.stops.find((s) => s.id === 19)!;
    const c = ctx({ current: { lat: lirr.lat + 0.0002, lng: lirr.lng, label: "Your location" } });
    const model = scripted([
      [{ name: "plan_trip", args: { from_place_id: "current_location", to_place_id: "life-sciences" } }],
      [{ name: "show_answer", args: { verdict: "info", message: "Take the Outer Loop from the LIRR stop.", plan_id: "plan1" } }],
    ]);
    const answer = await runAgent("Life Sciences?", c, model);
    expect(answer.card?.fromName).toBe("Your location");
    expect(answer.card?.mode).toBe("bus");
    expect(answer.card?.routeName).toBe("Outer Loop");
  });

  it("stops after too many steps instead of looping forever", async () => {
    const model = scripted([[{ name: "bus_status", args: {} }]]);
    const answer = await runAgent("buses?", ctx(), model);
    expect(answer.card).toBeNull();
    expect(answer.steps.length).toBe(6);
  });
});

describe("mock agent (AGENT_MODE=mock)", () => {
  it("reads deadlines the way people say them", async () => {
    const { deadlineIn } = await import("./mock");
    expect(deadlineIn("lab at 2")).toBe("14:00");
    expect(deadlineIn("by 9:30am")).toBe("09:30");
    expect(deadlineIn("before 11")).toBe("11:00");
    expect(deadlineIn("no time here")).toBeNull();
  });

  it("answers a from/to/deadline question with the real tools", async () => {
    const { mockClient } = await import("./mock");
    const answer = await runAgent(
      "I'm at the LIRR, lab in Life Sciences at 3. Will I make it?",
      ctx(),
      mockClient(places, false),
    );
    expect(answer.steps).toEqual(["plan_trip", "show_answer"]);
    expect(answer.card?.toName).toBe("Life Sciences");
    expect(answer.card?.deadline).toBe("3:00 PM");
    expect(["yes", "tight", "no"]).toContain(answer.verdict);
  });
});

describe("mock agent follow-ups", () => {
  it("treats the reply to 'where are you starting from?' as the start", async () => {
    const { mockClient } = await import("./mock");
    const first = await runAgent("How do I get to Javits?", ctx(), mockClient(places, false));
    expect(first.verdict).toBe("need_info");
    const history: Turn[] = [
      { role: "user", parts: [{ text: "How do I get to Javits?" }] },
      { role: "model", parts: [{ text: first.message }] },
    ];
    const second = await runAgent("SAC", ctx(), mockClient(places, false), history);
    expect(second.card?.fromName).toMatch(/SAC|Student Activities/);
    expect(second.card?.toName).toMatch(/Javits/);
  });

  it("reads 'from X to Y' in either order", async () => {
    const { mockClient } = await import("./mock");
    const a = await runAgent("to Javits from Chapin", ctx(), mockClient(places, false));
    expect(a.card?.fromName).toMatch(/Chapin/);
    expect(a.card?.toName).toMatch(/Javits/);
  });
});
