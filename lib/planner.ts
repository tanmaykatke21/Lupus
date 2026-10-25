import type { Bus } from "./etaspot";
import { meters, PATH_DETOUR, RUN_M_PER_MIN, WALK_M_PER_MIN, type LatLng } from "./geo";
import type { Network, Route, Stop } from "./network";

/** Furthest we'll ask someone to walk to or from a stop (path distance). */
export const MAX_STOP_WALK_M = 900;
/** Don't suggest buses that won't arrive for ages. */
const MAX_BOARD_MIN = 45;
// Used only for stretches beyond the stops ETA Spot lists, when no bus has shown us the real time.
const BUS_M_PER_MIN = 300;
const DWELL_MIN = 0.4;
/** Below this much spare time before you must leave, the card says "Leave now". */
export const LEAVE_NOW_MIN = 2;

export type LeaveStatus = "relax" | "walk" | "run";

export interface TripOption {
  busId: string;
  routeId: number;
  board: { stop: Stop; walkMin: number };
  alight: { stop: Stop; walkMin: number };
  /** Minutes until the bus reaches the boarding stop. */
  boardInMin: number;
  /** Minutes until you need to start walking (negative means you'd have to run). */
  leaveInMin: number;
  rideMin: number;
  /** Minutes from now until you reach the destination. */
  arriveInMin: number;
  status: LeaveStatus;
  /** True when part of the timing is our estimate rather than ETA Spot's prediction. */
  estimated: boolean;
}

export interface TripPlan {
  walkMin: number;
  walkMeters: number;
  /** Bus options, fastest first. */
  options: TripOption[];
  /** "walk" when walking gets you there at least as fast as any bus. */
  best: "walk" | "bus";
  /** Set when no stop is within walking range of the starting point. */
  farFromStops: boolean;
  nearestStopMeters: number;
}

type SegmentTimes = Map<string, number>;
const segKey = (routeId: number, from: number, to: number) => `${routeId}:${from}:${to}`;

/**
 * Learn how long each hop between consecutive stops takes from what the buses report right now.
 * If two buses disagree, keep the slower estimate so nobody is told they'll make a bus they won't.
 */
export function observedSegments(buses: Bus[]): SegmentTimes {
  const seg: SegmentTimes = new Map();
  for (const bus of buses) {
    for (let i = 1; i < bus.upcoming.length; i++) {
      const prev = bus.upcoming[i - 1];
      const cur = bus.upcoming[i];
      const dt = cur.minutes - prev.minutes;
      if (dt < 0 || dt > 30) continue;
      const k = segKey(bus.routeId, prev.stopId, cur.stopId);
      seg.set(k, Math.max(seg.get(k) ?? 0, dt));
    }
  }
  return seg;
}

/** Minutes for a bus on `route` to go from stop `from` to stop `to`, following the loop. */
export function rideAlong(
  route: Route,
  from: number,
  to: number,
  stops: Map<number, Stop>,
  seg: SegmentTimes,
): { minutes: number; estimated: boolean } | null {
  const order = route.stops;
  const start = order.indexOf(from);
  if (start < 0 || !order.includes(to) || from === to) return null;
  let minutes = 0;
  let estimated = false;
  for (let step = 0; step < order.length; step++) {
    const a = order[(start + step) % order.length];
    const b = order[(start + step + 1) % order.length];
    const seen = seg.get(segKey(route.id, a, b));
    if (seen !== undefined) {
      minutes += seen;
    } else {
      const sa = stops.get(a);
      const sb = stops.get(b);
      if (!sa || !sb) return null;
      minutes += (meters(sa, sb) * PATH_DETOUR) / BUS_M_PER_MIN + DWELL_MIN;
      estimated = true;
    }
    if (b === to) return { minutes, estimated };
  }
  return null;
}

/** When does this bus next reach `stopId`? Exact if ETA Spot lists it, otherwise extrapolated along the route. */
function arrivalAt(
  bus: Bus,
  route: Route,
  stopId: number,
  stops: Map<number, Stop>,
  seg: SegmentTimes,
): { minutes: number; estimated: boolean } | null {
  const listed = bus.upcoming.find((u) => u.stopId === stopId);
  if (listed) return { minutes: listed.minutes, estimated: false };
  const last = bus.upcoming.at(-1);
  if (!last) return null;
  const more = rideAlong(route, last.stopId, stopId, stops, seg);
  return more ? { minutes: last.minutes + more.minutes, estimated: true } : null;
}

function statusFor(leaveInMin: number): LeaveStatus {
  if (leaveInMin > LEAVE_NOW_MIN) return "relax";
  if (leaveInMin >= 0) return "walk";
  return "run";
}

export interface PlanOptions {
  /** The real walking distance along paths, when known; otherwise it's estimated from the straight line. */
  walkMeters?: number | null;
}

export function planTrip(origin: LatLng, destination: LatLng, network: Network, buses: Bus[], opts: PlanOptions = {}): TripPlan {
  const walkMeters = opts.walkMeters ?? meters(origin, destination) * PATH_DETOUR;
  const walkMin = walkMeters / WALK_M_PER_MIN;
  const stops = new Map(network.stops.map((s) => [s.id, s]));
  const seg = observedSegments(buses);

  const reachable = (from: LatLng) =>
    network.stops
      .map((stop) => ({ stop, pathM: meters(from, stop) * PATH_DETOUR }))
      .filter((s) => s.pathM <= MAX_STOP_WALK_M);
  const nearOrigin = reachable(origin);
  const nearDest = reachable(destination);
  const nearestStopMeters = Math.min(...network.stops.map((s) => meters(origin, s)));

  const options: TripOption[] = [];
  for (const bus of buses) {
    const route = network.routes.find((r) => r.id === bus.routeId);
    if (!route) continue;
    let best: TripOption | null = null;

    for (const b of nearOrigin) {
      if (!route.stops.includes(b.stop.id)) continue;
      const board = arrivalAt(bus, route, b.stop.id, stops, seg);
      if (!board || board.minutes > MAX_BOARD_MIN) continue;
      const walkTo = b.pathM / WALK_M_PER_MIN;
      const runTo = b.pathM / RUN_M_PER_MIN;
      if (runTo > board.minutes) continue; // can't make it even running

      for (const a of nearDest) {
        if (a.stop.id === b.stop.id || !route.stops.includes(a.stop.id)) continue;
        const listedB = bus.upcoming.findIndex((u) => u.stopId === b.stop.id);
        const listedA = bus.upcoming.findIndex((u) => u.stopId === a.stop.id);
        let ride: { minutes: number; estimated: boolean } | null;
        if (listedB >= 0 && listedA > listedB) {
          ride = { minutes: bus.upcoming[listedA].minutes - bus.upcoming[listedB].minutes, estimated: false };
        } else {
          ride = rideAlong(route, b.stop.id, a.stop.id, stops, seg);
        }
        if (!ride) continue;
        const walkFrom = a.pathM / WALK_M_PER_MIN;
        const leaveInMin = board.minutes - walkTo;
        const option: TripOption = {
          busId: bus.id,
          routeId: bus.routeId,
          board: { stop: b.stop, walkMin: walkTo },
          alight: { stop: a.stop, walkMin: walkFrom },
          boardInMin: board.minutes,
          leaveInMin,
          rideMin: ride.minutes,
          arriveInMin: board.minutes + ride.minutes + walkFrom,
          status: statusFor(leaveInMin),
          estimated: board.estimated || ride.estimated,
        };
        // Per bus, keep the earliest arrival; on a near tie prefer less walking.
        const better =
          !best ||
          option.arriveInMin < best.arriveInMin - 0.5 ||
          (Math.abs(option.arriveInMin - best.arriveInMin) <= 0.5 &&
            option.board.walkMin + option.alight.walkMin < best.board.walkMin + best.alight.walkMin);
        if (better) best = option;
      }
    }
    if (best) options.push(best);
  }

  options.sort((x, y) => x.arriveInMin - y.arriveInMin);
  const fastestBus = options[0]?.arriveInMin ?? Infinity;
  return {
    walkMin,
    walkMeters,
    options: options.slice(0, 4),
    best: walkMin <= fastestBus ? "walk" : "bus",
    farFromStops: nearOrigin.length === 0,
    nearestStopMeters,
  };
}

/** The rider's filter for trip options: whatever is fastest, only buses, or only walking. */
export type TravelMode = "best" | "bus" | "walk";

/** What the map should draw for the trip: a bus option (null when no bus can do it) or a walk. */
export type TripView = { kind: "bus"; option: TripOption | null } | { kind: "walk" };
