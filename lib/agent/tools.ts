// Tools the Gemini trip agent may call. Every fact the agent states comes from one of these,
// computed by our own code from ETA Spot data; Gemini only chooses which tool to call and writes the wording.
import { campusMinutes } from "../campusTime";
import { clockAfter } from "../campusClock";
import type { Bus } from "../etaspot";
import { meters, type LatLng } from "../geo";
import type { Network } from "../network";
import type { Place } from "../places";
import { planTrip, type TripOption, type TripPlan } from "../planner";
import { routeName } from "../routes";
import { searchPlaces } from "../search";

export interface AgentContext {
  network: Network;
  buses: Bus[];
  places: Place[];
  /** The rider's location, when the app knows it (GPS on campus, or the start they picked). */
  current: (LatLng & { label: string }) | null;
  nowMs: number;
  /** Plans made during this conversation turn, so show_answer can point at one by id. */
  plans: Map<string, StoredPlan>;
}

export interface StoredPlan {
  id: string;
  from: { id: string | null; name: string; lat: number; lng: number };
  to: Place;
  plan: TripPlan;
  /** Minutes from now until the deadline, when the rider gave one. */
  deadlineInMin: number | null;
  deadlineLabel: string | null;
}

/** JSON Schema tool declarations sent to Gemini. */
export const TOOL_DECLARATIONS = [
  {
    name: "find_place",
    description:
      "Look up a Stony Brook campus building, residence hall, landmark or bus stop by name or nickname. Returns place ids for plan_trip and stop_departures.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What the rider called the place, e.g. 'West Apartments', 'SAC', 'Life Sci'." } },
      required: ["query"],
    },
  },
  {
    name: "plan_trip",
    description:
      "Plan a trip right now using live buses and walking. Returns the fastest options with leave-in time, route, stops and arrival time, plus walking time. If arrive_by is given, also returns minutes of buffer before that time.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from_place_id: { type: "string", description: "Place id from find_place, or 'current_location' for where the rider is now." },
        to_place_id: { type: "string", description: "Place id from find_place." },
        arrive_by: { type: "string", description: "Optional deadline on the campus clock in 24-hour HH:MM, e.g. '14:00' for 2 PM." },
      },
      required: ["from_place_id", "to_place_id"],
    },
  },
  {
    name: "bus_status",
    description: "List buses running right now with their route, next few stops and times, and how crowded they are.",
    parametersJsonSchema: {
      type: "object",
      properties: { route: { type: "string", description: "Optional route name to filter by, e.g. 'Outer Loop'." } },
    },
  },
  {
    name: "stop_departures",
    description: "Next buses arriving at the stops nearest a place, soonest first.",
    parametersJsonSchema: {
      type: "object",
      properties: { place_id: { type: "string", description: "Place id from find_place." } },
      required: ["place_id"],
    },
  },
  {
    name: "show_answer",
    description:
      "Finish by showing the rider your answer. Call exactly once, last. Keep the message to one or two short sentences and use only numbers returned by other tools.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["yes", "tight", "no", "info", "need_info"],
          description:
            "yes/tight/no answer 'will I make it'; info for general answers; need_info when you must ask the rider something (e.g. where they're starting).",
        },
        message: { type: "string", description: "One or two short sentences for a student in a hurry." },
        plan_id: { type: "string", description: "Id of the plan_trip result this answer is about, if any." },
      },
      required: ["verdict", "message"],
    },
  },
] as const;

export type ToolName = (typeof TOOL_DECLARATIONS)[number]["name"];

const r1 = (n: number) => Math.round(n * 10) / 10;

function resolvePlace(ctx: AgentContext, id: string): Place | undefined {
  return ctx.places.find((p) => p.id === id);
}

/** "14:00" → minutes from now until that time today (negative if it has passed, within the last hour). */
export function deadlineFrom(arriveBy: string, nowMs: number): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(arriveBy ?? "");
  if (!m) return null;
  const target = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  let diff = target - campusMinutes(nowMs);
  if (diff < -60) diff += 1440;
  return diff;
}

function describeOption(o: TripOption, index: number, network: Network, nowMs: number) {
  return {
    option_index: index,
    route: routeName(o.routeId, network),
    board_stop: o.board.stop.name,
    walk_to_stop_min: r1(o.board.walkMin),
    leave_in_min: r1(o.leaveInMin),
    pace: o.status,
    bus_arrives_at: clockAfter(nowMs, o.boardInMin),
    ride_min: r1(o.rideMin),
    alight_stop: o.alight.stop.name,
    walk_from_stop_min: r1(o.alight.walkMin),
    arrive_at: clockAfter(nowMs, o.arriveInMin),
    arrive_in_min: r1(o.arriveInMin),
    partly_estimated: o.estimated,
  };
}

export function runTool(name: string, args: Record<string, unknown>, ctx: AgentContext): Record<string, unknown> {
  switch (name) {
    case "find_place": {
      const hits = searchPlaces(ctx.places, String(args.query ?? ""), 4);
      if (hits.length === 0) return { matches: [], note: "No campus place matches. Ask the rider for another name." };
      return { matches: hits.map((h) => ({ id: h.place.id, name: h.place.name, kind: h.place.category })) };
    }

    case "plan_trip": {
      const toId = String(args.to_place_id ?? "");
      const to = resolvePlace(ctx, toId);
      if (!to) return { error: `Unknown to_place_id "${toId}". Call find_place first.` };

      const fromId = String(args.from_place_id ?? "current_location");
      let from: StoredPlan["from"];
      if (fromId === "current_location") {
        if (!ctx.current) return { error: "The rider's location is unknown. Ask where they are starting (verdict need_info)." };
        from = { id: null, name: ctx.current.label, lat: ctx.current.lat, lng: ctx.current.lng };
      } else {
        const p = resolvePlace(ctx, fromId);
        if (!p) return { error: `Unknown from_place_id "${fromId}". Call find_place first.` };
        from = { id: p.id, name: p.name, lat: p.lat, lng: p.lng };
      }

      const plan = planTrip(from, to, ctx.network, ctx.buses);
      if (plan.farFromStops && meters(from, to) > 5000) {
        return { error: `The start is ${Math.round(plan.nearestStopMeters / 1000)} km from campus. Ask where on campus they are starting.` };
      }
      const deadlineInMin = typeof args.arrive_by === "string" ? deadlineFrom(args.arrive_by, ctx.nowMs) : null;
      const id = `plan${ctx.plans.size + 1}`;
      ctx.plans.set(id, {
        id,
        from,
        to,
        plan,
        deadlineInMin,
        deadlineLabel: deadlineInMin === null ? null : clockAfter(ctx.nowMs, deadlineInMin),
      });

      const bestArrive = plan.best === "walk" ? plan.walkMin : plan.options[0].arriveInMin;
      return {
        plan_id: id,
        from: from.name,
        to: to.name,
        now: clockAfter(ctx.nowMs, 0),
        best: plan.best,
        walk_all_the_way_min: r1(plan.walkMin),
        walk_arrive_at: clockAfter(ctx.nowMs, plan.walkMin),
        bus_options: plan.options.map((o, i) => describeOption(o, i, ctx.network, ctx.nowMs)),
        ...(deadlineInMin !== null && {
          deadline: clockAfter(ctx.nowMs, deadlineInMin),
          buffer_min_with_best: r1(deadlineInMin - bestArrive),
        }),
      };
    }

    case "bus_status": {
      const filter = String(args.route ?? "").toLowerCase().trim();
      const buses = ctx.buses
        .filter((b) => !filter || routeName(b.routeId, ctx.network).toLowerCase().includes(filter))
        .map((b) => ({
          route: routeName(b.routeId, ctx.network),
          crowding: b.crowding,
          seats_taken: `${b.load}/${b.capacity}`,
          next_stops: b.upcoming.slice(0, 5).map((u) => ({
            stop: ctx.network.stops.find((s) => s.id === u.stopId)?.name ?? `stop ${u.stopId}`,
            in_min: r1(u.minutes),
          })),
        }));
      return { now: clockAfter(ctx.nowMs, 0), buses, ...(buses.length === 0 && { note: "No matching buses are running right now." }) };
    }

    case "stop_departures": {
      const place = resolvePlace(ctx, String(args.place_id ?? ""));
      if (!place) return { error: "Unknown place_id. Call find_place first." };
      const near = ctx.network.stops
        .map((s) => ({ s, d: meters(place, s) }))
        .filter((x) => x.d < 400)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      const departures = near.flatMap(({ s }) =>
        ctx.buses.flatMap((b) =>
          b.upcoming
            .filter((u) => u.stopId === s.id)
            .map((u) => ({ stop: s.name, route: routeName(b.routeId, ctx.network), in_min: r1(u.minutes), at: clockAfter(ctx.nowMs, u.minutes) })),
        ),
      );
      departures.sort((a, b) => a.in_min - b.in_min);
      return {
        stops_checked: near.map((x) => x.s.name),
        departures: departures.slice(0, 6),
        ...(departures.length === 0 && { note: "No bus is predicted at these stops in ETA Spot's next-few-stops window." }),
      };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}
