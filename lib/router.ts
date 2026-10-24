// Trip planner: walk-only, or walk → wait → ride one bus → walk.
import { meters } from "./geo";
import type { WalkGraph, WalkOptions, WalkResult } from "./walk";
import type { BusRoute, BusStop, LngLat, StopEta } from "./types";

export const MAX_STOP_WALK_M = 600;
export const BOARD_BUFFER_MS = 60_000; // be at the stop a minute early
const MAX_OPTIONS = 3;
const HORIZON_MS = 3 * 60 * 60_000; // project estimated trips up to 3 h ahead

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
  rideSource: "eta" | "history" | "schedule";
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

// Upcoming departures of `route` at `stop`: listed ETAs, then projected by headway.
function departures(route: BusRoute, stopEtas: StopEta[], timing: RouteTimingEntry | undefined, liveBuses: number, until: number): Departure[] {
  const listed = stopEtas
    .filter(e => e.routeId === route.id)
    .sort((a, b) => a.arrivesAt - b.arrivesAt)
    .map((e): Departure => ({ at: e.arrivesAt, tripKey: e.tripKey, busId: e.busId, estimated: false }));
  if (!listed.length || !timing) return listed;
  const headwayMs = (timing.cycleMinutes / Math.max(1, liveBuses)) * 60_000;
  const out = [...listed];
  for (let t = listed[listed.length - 1].at + headwayMs; t <= until; t += headwayMs) {
    out.push({ at: t, tripKey: null, busId: null, estimated: true });
  }
  return out;
}

const minutes = (ms: number) => ms / 60_000;

export async function plan(req: PlanRequest, deps: RouterDeps): Promise<RouteOption[]> {
  const now = (req.time ?? new Date()).getTime();
  const arriveBy = req.arriveBy?.getTime();
  const walkOpts: WalkOptions = { accessible: req.accessible, at: new Date(now) };
  const { graph } = deps;

  const fromTree = graph.from(req.from, walkOpts);
  const direct = fromTree.to(req.to);
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
  const nearFrom = graph.from(req.from, walkOpts, MAX_STOP_WALK_M);
  const nearTo = graph.from(req.to, walkOpts, MAX_STOP_WALK_M); // paths are symmetric
  const boardWalk = new Map<number, WalkResult>();
  const alightWalk = new Map<number, WalkResult>();
  for (const s of deps.stops) {
    const w1 = nearFrom.to([s.lng, s.lat]);
    if (w1 && w1.meters <= MAX_STOP_WALK_M) boardWalk.set(s.id, w1);
    const w2 = nearTo.to([s.lng, s.lat]);
    if (w2 && w2.meters <= MAX_STOP_WALK_M) {
      alightWalk.set(s.id, { ...w2, coords: w2.coords.slice().reverse(), shortcuts: w2.shortcuts.slice().reverse() });
    }
  }

  const stopById = new Map(deps.stops.map(s => [s.id, s]));
  const etaCache = new Map<number, Promise<StopEta[]>>();
  const etasFor = (id: number) => {
    let p = etaCache.get(id);
    if (!p) etaCache.set(id, (p = deps.etas(id).catch(() => [])));
    return p;
  };

  const candidates: RouteOption[] = [];
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
        for (const dep of ordered) {
          const paired = dep.tripKey ? alightEtas.find(e => e.routeId === route.id && e.tripKey === dep.tripKey && e.arrivesAt > dep.at) : undefined;
          let rideMs: number, rideSource: BusLeg["rideSource"];
          if (paired) { rideMs = paired.arrivesAt - dep.at; rideSource = "eta"; }
          else if (historyRide !== null) { rideMs = historyRide * 60_000; rideSource = "history"; }
          else if (scheduleRide !== null) { rideMs = scheduleRide * 60_000; rideSource = "schedule"; }
          else break;

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
              coords: shapeBetween(route, board, alight), live: dep.busId !== null, rideSource,
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
            legs,
          };
          const better = !best || (arriveBy ? option.leaveBy > best.leaveBy : option.arriveAt < best.arriveAt);
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
  const rank = (a: RouteOption, b: RouteOption) => (arriveBy ? b.leaveBy - a.leaveBy : a.arriveAt - b.arriveAt);
  // Walking is always offered, so buses get the remaining slots.
  const buses = useful.sort(rank).slice(0, MAX_OPTIONS - options.length);
  return [...options, ...buses].sort(rank);
}
