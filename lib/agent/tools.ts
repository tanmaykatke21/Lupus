// Tools the Gemini trip agent may call. Every fact it states comes from one of these, computed by our
// own code (router, ETA Spot, LIRR schedule); Gemini only chooses tools and writes the wording.
// Adapted from Tanmay's agent to run on the prototype's planner.
import { meters } from "../geo";
import type { LirrTrain } from "../lirr";
import { placeById, scorePlaces, type Place } from "../places";
import type { RouteOption } from "../router";
import { campusClock, formatClock } from "../time";
import type { Bus, BusRoute, BusStop, LngLat, StopEta } from "../types";

export interface AgentContext {
  nowMs: number;
  /** Where the rider is, when the app knows (GPS or the start they picked). */
  current: { lat: number; lng: number; label: string } | null;
  routes: BusRoute[];
  stops: BusStop[];
  buses: Bus[];
  plan: (from: LngLat, to: LngLat, arriveBy?: number) => Promise<RouteOption[]>;
  stopEtas: (stopId: number) => Promise<StopEta[]>;
  trains: (direction: "west" | "east", afterMs: number) => LirrTrain[];
  /** Plans made during this turn, so show_answer can point at one by id. */
  plans: Map<string, StoredPlan>;
}

export interface StoredPlan {
  id: string;
  from: { name: string; lat: number; lng: number; placeId: string | null };
  to: Place;
  options: RouteOption[]; // best first, slower-than-walk buses removed
  deadline: number | null; // ms
  /** Earliest arrival if the rider leaves right now; "will I make it" compares this to the deadline. */
  earliestArrival: number;
  context: string | null; // "the 6:12 PM to Penn Station"
}

/** JSON Schema tool declarations sent to Gemini. */
export const TOOL_DECLARATIONS = [
  {
    name: "find_place",
    description: "Look up a Stony Brook place (building, dorm, dining hall, hospital, LIRR station, shopping, town) by name or nickname. Returns place ids.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What the rider called it, e.g. 'West Apartments', 'SAC', 'Life Sci', 'Walmart'." } },
      required: ["query"],
    },
  },
  {
    name: "plan_trip",
    description: "Plan a trip with live buses and walking. Returns the fastest options (leave-by, route, stops, arrival). With arrive_by, also the buffer in minutes.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from_place_id: { type: "string", description: "Place id from find_place, or 'current_location'." },
        to_place_id: { type: "string", description: "Place id from find_place." },
        arrive_by: { type: "string", description: "Optional deadline on the campus clock, 24-hour HH:MM (e.g. '14:00')." },
      },
      required: ["from_place_id", "to_place_id"],
    },
  },
  {
    name: "lirr_departures",
    description: "Next LIRR trains from Stony Brook station with live delays. west = toward NYC (Penn/Grand Central), east = Port Jefferson. Returns train ids usable as plan_trip deadlines via catch_train.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["west", "east"] },
        after: { type: "string", description: "Optional earliest departure, 24-hour HH:MM." },
      },
      required: ["direction"],
    },
  },
  {
    name: "catch_train",
    description: "Plan getting to Stony Brook station in time for a specific train from lirr_departures (arrives 5 minutes before it leaves).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from_place_id: { type: "string", description: "Place id, or 'current_location'." },
        train_key: { type: "string", description: "The key of a train from lirr_departures." },
      },
      required: ["from_place_id", "train_key"],
    },
  },
  {
    name: "bus_status",
    description: "Buses running right now, with their next stops and times.",
    parametersJsonSchema: { type: "object", properties: { route: { type: "string", description: "Optional route name filter, e.g. 'Outer Loop'." } } },
  },
  {
    name: "stop_departures",
    description: "Next buses at the stops nearest a place, soonest first.",
    parametersJsonSchema: {
      type: "object",
      properties: { place_id: { type: "string", description: "Place id from find_place." } },
      required: ["place_id"],
    },
  },
  {
    name: "show_answer",
    description: "Finish by showing the rider your answer. Call exactly once, last. One or two short sentences, using only numbers returned by other tools.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["yes", "tight", "no", "info", "need_info"], description: "yes/tight/no for 'will I make it'; info otherwise; need_info to ask the rider something." },
        message: { type: "string", description: "One or two short sentences." },
        plan_id: { type: "string", description: "Id of the plan this answer is about, if any." },
      },
      required: ["verdict", "message"],
    },
  },
] as const;

const r1 = (n: number) => Math.round(n * 10) / 10;
const TRAIN_BUFFER_MS = 5 * 60_000;

/** "14:00" → the next time that wall-clock time occurs on campus (today, or tomorrow if it passed > 1 h ago). */
export function deadlineFrom(hhmm: string, nowMs: number): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm ?? "");
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  let diff = Number(m[1]) * 60 + Number(m[2]) - campusClock(new Date(nowMs)).minutes;
  if (diff < -60) diff += 1440;
  return Math.floor(nowMs / 60_000) * 60_000 + diff * 60_000;
}

function describe(o: RouteOption, i: number) {
  const bus = o.legs.find(l => l.type === "bus");
  return {
    option_index: i,
    kind: o.kind,
    leave_by: formatClock(o.leaveBy),
    arrive_at: formatClock(o.arriveAt),
    total_min: r1(o.totalMinutes),
    ...(bus?.type === "bus" && {
      route: bus.routeName,
      board_stop: bus.boardStopName,
      bus_at: formatClock(bus.departAt),
      alight_stop: bus.alightStopName,
      ride_min: r1(o.breakdown.ride),
      tracked_live: bus.live,
    }),
    walk_min: r1(o.breakdown.walk),
    ...(o.reliability && { reliability: o.reliability }),
  };
}

const placeFor = (id: string) => placeById(id);

async function storePlan(ctx: AgentContext, fromId: string, to: Place, deadline: number | null, context: string | null) {
  let from: StoredPlan["from"];
  if (fromId === "current_location") {
    if (!ctx.current) return { error: "The rider's location is unknown. Ask where they're starting (verdict need_info)." };
    from = { ...ctx.current, name: ctx.current.label, placeId: null };
  } else {
    const p = placeFor(fromId);
    if (!p) return { error: `Unknown from_place_id "${fromId}". Call find_place first.` };
    from = { name: p.name, lat: p.lat, lng: p.lng, placeId: p.id };
  }
  const all = await ctx.plan([from.lng, from.lat], [to.lng, to.lat], deadline ?? undefined);
  const options = all.filter(o => !o.slowerThanWalk);
  if (!options.length) return { error: `No walking or bus route from ${from.name} to ${to.name} right now.` };
  // With a deadline, `options` are the latest departures that still make it (arrival == deadline).
  // The buffer that answers "will I make it" comes from leaving now.
  const leaveNow = deadline === null ? options
    : (await ctx.plan([from.lng, from.lat], [to.lng, to.lat])).filter(o => !o.slowerThanWalk);
  const earliestArrival = (leaveNow[0] ?? options[0]).arriveAt;
  const id = `plan${ctx.plans.size + 1}`;
  ctx.plans.set(id, { id, from, to, options, deadline, earliestArrival, context });
  return {
    plan_id: id,
    from: from.name,
    to: to.name,
    now: formatClock(ctx.nowMs),
    options: options.map(describe),
    ...(deadline !== null && {
      deadline: formatClock(deadline),
      earliest_arrival_if_leaving_now: formatClock(earliestArrival),
      buffer_min_with_best: r1((deadline - earliestArrival) / 60_000),
    }),
  };
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: AgentContext): Promise<Record<string, unknown>> {
  switch (name) {
    case "find_place": {
      const hits = scorePlaces(String(args.query ?? ""), 4);
      if (!hits.length) return { matches: [], note: "No place matches. Ask the rider for another name." };
      return { matches: hits.map(h => ({ id: h.place.id, name: h.place.name, kind: h.place.category, ...(h.place.service && { shuttle: h.place.service }) })) };
    }

    case "plan_trip": {
      const to = placeFor(String(args.to_place_id ?? ""));
      if (!to) return { error: `Unknown to_place_id "${args.to_place_id}". Call find_place first.` };
      const deadline = typeof args.arrive_by === "string" ? deadlineFrom(args.arrive_by, ctx.nowMs) : null;
      return storePlan(ctx, String(args.from_place_id ?? "current_location"), to, deadline, null);
    }

    case "lirr_departures": {
      const direction = args.direction === "east" ? "east" : "west";
      const after = typeof args.after === "string" ? deadlineFrom(args.after, ctx.nowMs) ?? ctx.nowMs : ctx.nowMs;
      const trains = ctx.trains(direction, after).slice(0, 5);
      return {
        trains: trains.map(t => ({
          key: t.key, departs: formatClock(t.expected), to: t.destination,
          delay_min: t.delayMin, canceled: t.canceled,
          ...(t.stations.penn && { penn_at: formatClock(t.stations.penn) }),
          ...(t.stations.grandCentral && { grand_central_at: formatClock(t.stations.grandCentral) }),
        })),
        ...(trains.length === 0 && { note: "No trains in that window." }),
      };
    }

    case "catch_train": {
      const key = String(args.train_key ?? "");
      const train = [...ctx.trains("west", ctx.nowMs), ...ctx.trains("east", ctx.nowMs)].find(t => t.key === key);
      if (!train) return { error: `Unknown train_key "${key}". Call lirr_departures first.` };
      const station = placeFor("lirr")!;
      const label = `the ${formatClock(train.expected)} to ${train.destination.replace(" · change for NYC", "")}`;
      return storePlan(ctx, String(args.from_place_id ?? "current_location"), station, train.expected - TRAIN_BUFFER_MS, label);
    }

    case "bus_status": {
      const filter = String(args.route ?? "").toLowerCase().trim();
      const routeName = (id: number) => ctx.routes.find(r => r.id === id)?.name ?? `Route ${id}`;
      const buses = ctx.buses
        .filter(b => b.inService && (!filter || routeName(b.routeId).toLowerCase().includes(filter)))
        .map(b => ({
          route: routeName(b.routeId),
          bus: b.id,
          ...(b.load !== null && { seats_taken_pct: Math.round(b.load * 100) }),
          next_stops: (b.upcoming ?? []).slice(0, 5).map(u => ({
            stop: ctx.stops.find(s => s.id === u.stopId)?.name ?? `stop ${u.stopId}`,
            in_min: u.minutes,
          })),
        }));
      return { now: formatClock(ctx.nowMs), buses, ...(buses.length === 0 && { note: "No matching buses are running right now." }) };
    }

    case "stop_departures": {
      const place = placeFor(String(args.place_id ?? ""));
      if (!place) return { error: "Unknown place_id. Call find_place first." };
      const near = ctx.stops
        .map(s => ({ s, d: meters([place.lng, place.lat], [s.lng, s.lat]) }))
        .filter(x => x.d < 400)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      const routeName = (id: number) => ctx.routes.find(r => r.id === id)?.name ?? `Route ${id}`;
      const lists = await Promise.all(near.map(({ s }) => ctx.stopEtas(s.id).catch(() => [] as StopEta[])));
      const departures = lists.flat()
        .map(e => ({ stop: ctx.stops.find(s => s.id === e.stopId)?.name, route: routeName(e.routeId), at: formatClock(e.arrivesAt), in_min: e.minutes, live: !!e.busId }))
        .sort((a, b) => a.in_min - b.in_min)
        .slice(0, 6);
      return {
        stops_checked: near.map(x => x.s.name),
        departures,
        ...(departures.length === 0 && { note: "No buses are listed at these stops right now." }),
      };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}
