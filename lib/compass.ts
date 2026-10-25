// Route-following compass: where the needle points and which phase of the trip we're in.
import { meters } from "./geo";
import type { RouteOption } from "./router";
import type { LngLat } from "./types";

/** Degrees clockwise from true north, from a to b. */
export function bearing(a: LngLat, b: LngLat) {
  const rad = Math.PI / 180;
  const [lng1, lat1] = [a[0] * rad, a[1] * rad];
  const [lng2, lat2] = [b[0] * rad, b[1] * rad];
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Signed smallest rotation from `from` to `to`, in (-180, 180]. */
export function turn(from: number, to: number) {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

export function lineLength(line: LngLat[]) {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += meters(line[i - 1], line[i]);
  return m;
}

/** Closest point on a polyline: how far along it is and how far off the line the point is. */
export function project(line: LngLat[], p: LngLat) {
  // Local flat projection is plenty at campus scale.
  const k = Math.cos((p[1] * Math.PI) / 180);
  const xy = (q: LngLat): [number, number] => [q[0] * 111_320 * k, q[1] * 110_540];
  const P = xy(p);
  let best = { along: 0, offset: Infinity }, walked = 0;
  for (let i = 1; i < line.length; i++) {
    const A = xy(line[i - 1]), B = xy(line[i]);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2)) : 0;
    const off = Math.hypot(A[0] + t * dx - P[0], A[1] + t * dy - P[1]);
    const seg = meters(line[i - 1], line[i]);
    if (off < best.offset) best = { along: walked + t * seg, offset: off };
    walked += seg;
  }
  return best;
}

/** The point `distance` meters along a polyline (clamped to its ends). */
export function pointAlong(line: LngLat[], distance: number): LngLat {
  if (distance <= 0) return line[0];
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = meters(line[i - 1], line[i]);
    if (walked + seg >= distance) {
      const t = seg ? (distance - walked) / seg : 0;
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
    walked += seg;
  }
  return line[line.length - 1];
}

export const LOOKAHEAD_M = 25;

/**
 * Where to point while following `line` from `p`: a spot a little way ahead on the route, so the
 * needle bends with the path (around buildings, through shortcuts) instead of aiming straight at
 * the end. Off the route by more than the lookahead, it points back to the nearest part of it.
 */
export function guide(line: LngLat[], p: LngLat) {
  const total = lineLength(line);
  const { along, offset } = project(line, p);
  const ahead = offset > LOOKAHEAD_M ? along : Math.min(total, along + LOOKAHEAD_M);
  const target = pointAlong(line, ahead);
  return { target, bearing: bearing(p, target), remaining: Math.max(0, total - along), offset };
}

export type Phase =
  | { kind: "walk"; line: LngLat[]; toLabel: string; final: boolean }
  | { kind: "wait"; stop: LngLat; stopName: string; routeName: string; color: string; busId: string | null; departAt: number; live: boolean }
  | { kind: "ride"; line: LngLat[]; alight: LngLat; alightName: string; routeName: string; color: string; stopCount: number; arriveAt: number }
  | { kind: "arrive"; name: string };

/** Turns a route option into compass phases: walk → wait → ride → walk → arrive. */
export function phasesFor(option: RouteOption, destination: string): Phase[] {
  const out: Phase[] = [];
  option.legs.forEach((leg, i) => {
    if (leg.type === "walk") {
      const final = i === option.legs.length - 1;
      if (leg.meters < 15 && !final) return;
      if (leg.meters >= 15) out.push({ kind: "walk", line: leg.coords, toLabel: final ? destination : `${leg.toLabel} stop`, final });
    } else if (leg.type === "bus") {
      const stop = leg.coords[0], alight = leg.coords[leg.coords.length - 1];
      out.push({
        kind: "wait", stop, stopName: leg.boardStopName, routeName: leg.routeName, color: leg.color,
        busId: leg.busId, departAt: leg.departAt, live: leg.live,
      });
      out.push({
        kind: "ride", line: leg.coords, alight, alightName: leg.alightStopName, routeName: leg.routeName,
        color: leg.color, stopCount: leg.stopCount, arriveAt: leg.arriveAt,
      });
    }
  });
  out.push({ kind: "arrive", name: destination });
  return out;
}

const WALK_DONE_M = 15;
const ALIGHT_RADIUS_M = 40;

/** Whether the current phase is complete given where the traveler is and the time. */
export function phaseDone(phase: Phase, location: LngLat | null, now: number) {
  switch (phase.kind) {
    case "walk": {
      if (!location) return false;
      const end = phase.line[phase.line.length - 1];
      return meters(location, end) < WALK_DONE_M || guide(phase.line, location).remaining < WALK_DONE_M;
    }
    case "wait":
      return now > phase.departAt + 45_000; // the bus has come and gone: assume we're aboard
    case "ride":
      return (!!location && meters(location, phase.alight) < ALIGHT_RADIUS_M) || now > phase.arriveAt + 60_000;
    case "arrive":
      return false;
  }
}
