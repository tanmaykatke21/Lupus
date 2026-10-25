// Trip planner: walk-only, or walk → wait → ride one bus → walk.
import { meters } from "./geo";
import { ACCESSIBLE_WALK_MPS, WALK_MPS, type WalkGraph, type WalkOptions, type WalkResult } from "./walk";
import type { BusRoute, BusStop, LngLat, StopEta } from "./types";

export const MAX_STOP_WALK_M = 600;
export const BOARD_BUFFER_MS = 60_000; // be at the stop a minute early
/**
 * ETA Spot's capacity counts seats, and drivers let students stand once seats run out, so a bus
 * only counts as one you can't board at 110% of its seats (about 10% standing room).
 */
export const FULL_LOAD = 1.1;
const MAX_OPTIONS = 3;
const HORIZON_MS = 2 * 60 * 60_000; // project estimated trips up to 2 h ahead
// Off the campus walking map (e.g. Walmart, Port Jefferson) we fall back to straight-line walks.
const OFF_MAP_DETOUR = 1.3;
const MAX_OFF_MAP_WALK_M = 2000;
// Ride estimate from the route shape when ETA Spot can't pair a trip and there's no timetable.
const BUS_MPS = 8;
const STOP_DWELL_S = 30;

export interface RouteTimingEntry {
  offsets: Record<string, number>; // minutes from first stop
  cycleMinutes: number;
}

export interface RouterDeps {
  graph: WalkGraph;
  routes: BusRoute[];
  stops: BusStop[];
  timing: Record<string, RouteTimingEntry>;
  etas: (stopId: number) => Promise<StopEta[]>;
  liveBusCount: (routeId: number) => number;
  /** Historical stop-to-stop minutes (Tiger Data), used when ETA Spot can't pair a trip. */
  historicalRide?: (routeId: number, fromStop: number, toStop: number, at: Date) => number | null;
  /** Live fraction of seats taken for a bus (0..1), from ETA Spot's load/capacity. */
  busLoad?: (busId: string) => number | null;
  /** Demo: treat the next catchable bus on every route as full, to show rerouting. */
  demoFullFirst?: boolean;
}

export interface PlanRequest {
  from: LngLat;
  to: LngLat;
  time?: Date; // "now" for planning
  arriveBy?: Date;
  accessible?: boolean;
}

export interface WalkLeg extends Omit<WalkResult, "coords"> {
  type: "walk";
  coords: LngLat[];
  toLabel: string;
}
export interface WaitLeg { type: "wait"; stopId: number; stopName: string; seconds: number }
export interface BusLeg {
  type: "bus";
  routeId: number;
  routeName: string;
  color: string;
  busId: string | null;
  tripKey: string | null;
  boardStopId: number;
  boardStopName: string;
  alightStopId: number;
  alightStopName: string;
  departAt: number;
  arriveAt: number;
  stopCount: number;
  coords: LngLat[];
  live: boolean; // departure time comes from a bus ETA Spot is tracking
  load: number | null; // fraction of seats taken (live buses only)
  rideSource: "eta" | "history" | "schedule" | "estimate";
}
export type Leg = WalkLeg | WaitLeg | BusLeg;

export interface RouteOption {
  id: string;
  kind: "walk" | "bus";
  leaveBy: number; // latest moment to leave and still make it (ms)
  arriveAt: number;
  slackMinutes: number | null; // minutes from now until leaveBy; null = no deadline (walk now)
  totalMinutes: number;
  breakdown: { walk: number; wait: number; ride: number }; // minutes
  estimated: boolean; // departure projected from headway rather than a listed ETA
  reliability?: string | null; // from Tiger Data history, e.g. "Usually 2 min later than shown"
  /** A bus that loses to walking; only offered for the "Bus" filter, never as a best option. */
  slowerThanWalk?: boolean;
  /** We skipped this packed bus to choose the option (shown to the rider, spoken on reroute). */
  skippedFull?: { routeName: string; busId: string | null; at: number; demo: boolean };
  legs: Leg[];
}

interface Departure { at: number; tripKey: string | null; busId: string | null; estimated: boolean }

// Stop positions along a route, in order. `j` comes after `i` on the same lap or the next one.
function stopsBetween(route: BusRoute, i: number, j: number) {
  return (j - i + route.stopIds.length) % route.stopIds.length;
}

function rideMinutes(timing: RouteTimingEntry | undefined, from: number, to: number) {
  if (!timing) return null;
  const a = timing.offsets[from], b = timing.offsets[to];
  if (a === undefined || b === undefined) return null;
  return b > a ? b - a : b - a + timing.cycleMinutes;
}

// The part of the route shape between two stops, following the route's direction (wrapping on loops).
export function shapeBetween(route: BusRoute, a: BusStop, b: BusStop): LngLat[] {
  const shape = route.shape;
  if (shape.length < 2) return [[a.lng, a.lat], [b.lng, b.lat]];
  const closest = (p: LngLat, from = 0, count = shape.length) => {
    let best = from, bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const idx = (from + k) % shape.length;
      const d = meters(p, shape[idx]);
      if (d < bestD) { bestD = d; best = idx; }
    }
    return best;
  };
  const ia = closest([a.lng, a.lat]);
  // Search forward from the boarding point for the alighting point.
  const ib = closest([b.lng, b.lat], ia + 1, shape.length - 1);
  const out: LngLat[] = [[a.lng, a.lat]];
  for (let k = ia; k !== ib; k = (k + 1) % shape.length) out.push(shape[k]);
  out.push(shape[ib], [b.lng, b.lat]);
  return out;
}

// Upcoming departures of `route` at `stop`: listed ETAs, then projected by headway — but only while
// buses are actually running, so we never invent trips for a shuttle that runs on other days.
function departures(route: BusRoute, stopEtas: StopEta[], timing: RouteTimingEntry | undefined, liveBuses: number, until: number): Departure[] {
  const listed = stopEtas
    .filter(e => e.routeId === route.id)
    .sort((a, b) => a.arrivesAt - b.arrivesAt)
    .map((e): Departure => ({ at: e.arrivesAt, tripKey: e.tripKey, busId: e.busId, estimated: false }));
  if (!listed.length || !timing || liveBuses === 0) return listed;
  const headwayMs = (timing.cycleMinutes / Math.max(1, liveBuses)) * 60_000;
  const out = [...listed];
  for (let t = listed[listed.length - 1].at + headwayMs; t <= until; t += headwayMs) {
    out.push({ at: t, tripKey: null, busId: null, estimated: true });
  }
  return out;
}

const minutes = (ms: number) => ms / 60_000;

/** Ride minutes from distance along the route shape, for routes with no timetable yet. */
export function estimateRideMinutes(route: BusRoute, a: BusStop, b: BusStop, stopCount: number) {
  const line = shapeBetween(route, a, b);
  let m = 0;
  for (let k = 1; k < line.length; k++) m += meters(line[k - 1], line[k]);
  return (m / BUS_MPS + stopCount * STOP_DWELL_S) / 60;
}

function straightWalk(a: LngLat, b: LngLat, accessible?: boolean): WalkResult {
  const m = meters(a, b) * OFF_MAP_DETOUR;
  return { meters: m, seconds: m / (accessible ? ACCESSIBLE_WALK_MPS : WALK_MPS), coords: [a, b], shortcuts: [], stairs: false };
}

/**
 * Ordering for options (negative = a is better). Leave-now: earliest arrival. Arrive-by: latest
 * leave-by. Ties (e.g. the same bus with different alighting stops) go to the earlier arrival,
 * then the shorter walk, so we never walk from a stop when the bus continues closer.
 */
export function compareOptions(a: RouteOption, b: RouteOption, arriveBy: boolean) {
  const SEC = 1000;
  if (arriveBy && Math.abs(a.leaveBy - b.leaveBy) >= SEC) return b.leaveBy - a.leaveBy;
  if (Math.abs(a.arriveAt - b.arriveAt) >= SEC) return a.arriveAt - b.arriveAt;
  return a.breakdown.walk - b.breakdown.walk;
}

export async function plan(req: PlanRequest, deps: RouterDeps): Promise<RouteOption[]> {
  const now = (req.time ?? new Date()).getTime();
  const arriveBy = req.arriveBy?.getTime();
  const walkOpts: WalkOptions = { accessible: req.accessible, at: new Date(now) };
  const { graph } = deps;

  // Either end may be off the campus walking map (shopping, Port Jefferson): walk straight there.
  const tree = (p: LngLat, max?: number) => (graph.nearestNode(p) ? graph.from(p, walkOpts, max) : null);
  const walkTo = (t: ReturnType<typeof tree>, a: LngLat, b: LngLat, max: number) => {
    const w = t?.to(b);
    if (w) return w.meters <= max ? w : null;
    return meters(a, b) * OFF_MAP_DETOUR <= max ? straightWalk(a, b, req.accessible) : null;
  };

  const fromTree = tree(req.from);
  const direct = walkTo(fromTree, req.from, req.to, fromTree && graph.nearestNode(req.to) ? Infinity : MAX_OFF_MAP_WALK_M);
  const options: RouteOption[] = [];

  if (direct) {
    const walkMs = direct.seconds * 1000;
    const leaveBy = arriveBy ? arriveBy - walkMs : now;
    const start = arriveBy ? Math.max(now, leaveBy) : now;
    options.push({
      id: "walk",
      kind: "walk",
      leaveBy,
      arriveAt: start + walkMs,
      slackMinutes: arriveBy ? minutes(leaveBy - now) : null,
      totalMinutes: minutes(walkMs),
      breakdown: { walk: minutes(walkMs), wait: 0, ride: 0 },
      estimated: false,
      legs: [{ type: "walk", ...direct, toLabel: "your destination" }],
    });
  }

  // Candidate stops near each end, by walking distance.
  const nearFrom = tree(req.from, MAX_STOP_WALK_M);
  const nearTo = tree(req.to, MAX_STOP_WALK_M); // paths are symmetric
  const boardWalk = new Map<number, WalkResult>();
  const alightWalk = new Map<number, WalkResult>();
  for (const s of deps.stops) {
    const p: LngLat = [s.lng, s.lat];
    const w1 = walkTo(nearFrom, req.from, p, MAX_STOP_WALK_M);
    if (w1) boardWalk.set(s.id, w1);
    const w2 = walkTo(nearTo, req.to, p, MAX_STOP_WALK_M);
    if (w2) alightWalk.set(s.id, { ...w2, coords: w2.coords.slice().reverse(), shortcuts: w2.shortcuts.slice().reverse() });
  }

  const stopById = new Map(deps.stops.map(s => [s.id, s]));
  const etaCache = new Map<number, Promise<StopEta[]>>();
  const etasFor = (id: number) => {
    let p = etaCache.get(id);
    if (!p) etaCache.set(id, (p = deps.etas(id).catch(() => [])));
    return p;
  };

  const candidates: RouteOption[] = [];
  let firstSkipped: RouteOption["skippedFull"] | null = null;
  await Promise.all(deps.routes.map(async route => {
    const timing = deps.timing[route.id];
    const live = deps.liveBusCount(route.id);
    let best: RouteOption | null = null;

    for (let i = 0; i < route.stopIds.length; i++) {
      const boardId = route.stopIds[i];
      const toStop = boardWalk.get(boardId);
      if (!toStop) continue;
      const board = stopById.get(boardId);
      if (!board) continue;
      const boardEtas = await etasFor(boardId);
      const upcoming = departures(route, boardEtas, timing, live, now + HORIZON_MS);
      if (!upcoming.length) continue;
      const walkToStopMs = toStop.seconds * 1000;

      for (const [alightId, fromStop] of alightWalk) {
        if (alightId === boardId) continue;
        const j = route.stopIds.indexOf(alightId);
        if (j === -1) continue;
        const alight = stopById.get(alightId);
        if (!alight) continue;
        const walkFromStopMs = fromStop.seconds * 1000;

        // Ride time: same trip at both stops (live/scheduled ETA) → history → schedule offsets.
        const alightEtas = await etasFor(alightId);
        const scheduleRide = rideMinutes(timing, boardId, alightId);
        const historyRide = deps.historicalRide?.(route.id, boardId, alightId, new Date(now)) ?? null;

        // Earliest catchable bus (leave now), or the latest one that still arrives on time.
        const earliestAtStop = now + walkToStopMs + BOARD_BUFFER_MS;
        const usable = upcoming.filter(d => d.at >= earliestAtStop);
        const ordered = arriveBy ? usable.slice().reverse() : usable;
        let skipped: RouteOption["skippedFull"] | null = null;
        for (const dep of ordered) {
          // Can't board a packed bus: take the next one on this route (other routes compete as usual).
          const load = dep.busId ? deps.busLoad?.(dep.busId) ?? null : null;
          const demoFull = !!deps.demoFullFirst && dep === usable[0];
          if ((load !== null && load >= FULL_LOAD) || demoFull) {
            skipped ??= { routeName: route.name, busId: dep.busId, at: dep.at, demo: demoFull && !(load !== null && load >= FULL_LOAD) };
            firstSkipped ??= skipped;
            continue;
          }
          const paired = dep.tripKey ? alightEtas.find(e => e.routeId === route.id && e.tripKey === dep.tripKey && e.arrivesAt > dep.at) : undefined;
          let rideMs: number, rideSource: BusLeg["rideSource"];
          if (paired) { rideMs = paired.arrivesAt - dep.at; rideSource = "eta"; }
          else if (historyRide !== null) { rideMs = historyRide * 60_000; rideSource = "history"; }
          else if (scheduleRide !== null) { rideMs = scheduleRide * 60_000; rideSource = "schedule"; }
          else { rideMs = estimateRideMinutes(route, board, alight, stopsBetween(route, i, j)) * 60_000; rideSource = "estimate"; }

          const arriveAt = dep.at + rideMs + walkFromStopMs;
          if (arriveBy && arriveAt > arriveBy) continue;
          const leaveBy = dep.at - BOARD_BUFFER_MS - walkToStopMs;
          const start = arriveBy ? Math.max(now, leaveBy) : now;
          const waitMs = Math.max(0, dep.at - (start + walkToStopMs));
          const legs: Leg[] = [
            { type: "walk", ...toStop, toLabel: board.name },
            { type: "wait", stopId: board.id, stopName: board.name, seconds: waitMs / 1000 },
            {
              type: "bus", routeId: route.id, routeName: route.name, color: route.color,
              busId: dep.busId, tripKey: dep.tripKey,
              boardStopId: board.id, boardStopName: board.name, alightStopId: alight.id, alightStopName: alight.name,
              departAt: dep.at, arriveAt: dep.at + rideMs, stopCount: stopsBetween(route, i, j),
              coords: shapeBetween(route, board, alight), live: dep.busId !== null, rideSource, load,
            },
            { type: "walk", ...fromStop, toLabel: "your destination" },
          ];
          const option: RouteOption = {
            id: `bus-${route.id}-${board.id}-${alight.id}`,
            kind: "bus",
            leaveBy,
            arriveAt,
            slackMinutes: minutes(leaveBy - now),
            totalMinutes: minutes(arriveAt - start),
            breakdown: { walk: minutes(walkToStopMs + walkFromStopMs), wait: minutes(waitMs), ride: minutes(rideMs) },
            estimated: dep.estimated,
            ...(skipped && { skippedFull: skipped }),
            legs,
          };
          const better = !best || compareOptions(option, best, !!arriveBy) < 0;
          if (better) best = option;
          break; // first acceptable departure in order is the best for this board/alight pair
        }
      }
    }
    if (best) candidates.push(best);
  }));

  // A bus option only earns a slot if it beats walking.
  const walk = options[0];
  const useful = candidates.filter(c => !walk || (arriveBy ? c.leaveBy > walk.leaveBy : c.arriveAt < walk.arriveAt));
  const rank = (a: RouteOption, b: RouteOption) => compareOptions(a, b, !!arriveBy);
  // Walking is always offered, so buses get the remaining slots.
  const buses = useful.sort(rank).slice(0, MAX_OPTIONS - options.length);
  // For the "Bus" filter, also keep the fastest bus that loses to walking, flagged and ranked last.
  const slower = candidates.filter(c => !useful.includes(c)).sort(rank)[0];
  const extra = !buses.length && slower ? [{ ...slower, slowerThanWalk: true }] : [];
  // If a packed bus pushed us onto walking, say so on the walk option too.
  if (walk && firstSkipped && !buses.some(b => b.skippedFull)) walk.skippedFull = firstSkipped;
  return [...[...options, ...buses].sort(rank), ...extra];
}
