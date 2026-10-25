// Turn-by-turn walking: where on the route the walker is, what's walked and what's left, and the next turn.
// Everything works on a route's [lng, lat] line from /api/walk, in flat meters around the route.

import type { LatLng } from "./geo";

export type TurnKind = "slight-left" | "left" | "sharp-left" | "slight-right" | "right" | "sharp-right" | "u-turn";

export interface Turn {
  /** Meters from the start of the route. */
  atM: number;
  kind: TurnKind;
}

export interface NavRoute {
  coords: [number, number][];
  x: number[];
  y: number[];
  /** Meters from the start to each point. */
  cum: number[];
  total: number;
  turns: Turn[];
  lng0: number;
  lat0: number;
  kx: number;
  ky: number;
}

export interface Fix {
  /** How far along the route the walker is, in meters. */
  progressM: number;
  /** The walker's spot on the route. */
  snapped: [number, number];
  /** How far the reported position is from the route. */
  offM: number;
  /** Direction of the route at that spot, degrees clockwise from north. */
  bearing: number;
}

/** Farther than this from the route, the walker has probably left it. */
export const OFF_ROUTE_M = 30;
/** Within this distance of the end, the walker has arrived. */
export const ARRIVED_M = 15;

/** Smallest change of direction that counts as a turn. */
const MIN_TURN_DEG = 35;
/**
 * Direction is measured from this far before a point to this far after it, so the small wiggles of real
 * footpaths (a curve around a lamp post, a kink at a curb) don't read as turns.
 */
const LOOK_M = 15;
/** Turns this close together are one turn (crossing a road to a path that carries on the other side). */
const MERGE_M = 15;

/**
 * Prepare a route for navigation. `junctions` (indexes into coords where paths meet) limits turns to the
 * places a walker actually has to choose a way; without it every bend is considered.
 */
export function prepareRoute(coords: [number, number][], junctions?: number[]): NavRoute {
  const lat0 = coords[0][1];
  const lng0 = coords[0][0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const x = coords.map((c) => (c[0] - lng0) * kx);
  const y = coords.map((c) => (c[1] - lat0) * ky);
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
  const route: NavRoute = { coords, x, y, cum, total: cum[cum.length - 1], turns: [], lng0, lat0, kx, ky };
  route.turns = findTurns(route, junctions ? new Set(junctions) : null);
  return route;
}

/** Point (in flat meters) at a distance along the route. */
function xyAt(r: NavRoute, m: number): [number, number] {
  const d = Math.max(0, Math.min(r.total, m));
  let lo = 0;
  let hi = r.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = r.cum[hi] - r.cum[lo];
  const t = seg === 0 ? 0 : (d - r.cum[lo]) / seg;
  return [r.x[lo] + t * (r.x[hi] - r.x[lo]), r.y[lo] + t * (r.y[hi] - r.y[lo])];
}

function toLngLat(r: NavRoute, [x, y]: [number, number]): [number, number] {
  return [r.lng0 + x / r.kx, r.lat0 + y / r.ky];
}

export function pointAt(r: NavRoute, m: number): [number, number] {
  return toLngLat(r, xyAt(r, m));
}

/** Degrees clockwise from north, from a to b. */
function bearing(a: [number, number], b: [number, number]): number {
  return ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

/** Signed change of direction in (-180, 180]; positive turns right. */
function delta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

function kindOf(d: number): TurnKind | null {
  const a = Math.abs(d);
  if (a < MIN_TURN_DEG) return null;
  if (a >= 165) return "u-turn";
  const side = d > 0 ? "right" : "left";
  if (a < 60) return `slight-${side}`;
  if (a < 135) return side;
  return `sharp-${side}`;
}

function findTurns(r: NavRoute, junctions: Set<number> | null): Turn[] {
  const n = r.coords.length;
  // In routes from the path network (the ones with junctions) the first and last legs are straight links
  // between the trip's ends and the nearest path, not paths anyone walks along, so directions are measured
  // on the path itself.
  const linked = junctions !== null && n > 3;
  const pathStart = linked ? r.cum[1] : 0;
  const pathEnd = linked ? r.cum[n - 2] : r.total;
  const dirInto = (m: number) => bearing(xyAt(r, Math.max(pathStart, m - LOOK_M)), xyAt(r, m));
  const dirOutOf = (m: number) => bearing(xyAt(r, m), xyAt(r, Math.min(pathEnd, m + LOOK_M)));

  // Places where the way bends noticeably.
  const bends: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (junctions && !junctions.has(i)) continue;
    const at = r.cum[i];
    if (at - pathStart < 1 || pathEnd - at < 1) continue;
    if (Math.abs(delta(dirInto(at), dirOutOf(at))) >= 15) bends.push(at);
  }
  // Bends close together are one turn, measured from before the first to after the last.
  const turns: Turn[] = [];
  for (let k = 0; k < bends.length; ) {
    let j = k;
    while (j + 1 < bends.length && bends[j + 1] - bends[j] <= MERGE_M) j++;
    const kind = kindOf(delta(dirInto(bends[k]), dirOutOf(bends[j])));
    if (kind) turns.push({ atM: bends[k], kind });
    k = j + 1;
  }
  return turns;
}

/**
 * Where a position falls on the route. With the previous progress known, spots that would mean jumping far
 * ahead or back (a parallel stretch of the same route) cost extra, so the walker stays on the stretch
 * they're actually on; small backward GPS jitter doesn't move them back.
 */
export function locate(r: NavRoute, pos: LatLng, lastProgressM: number | null): Fix {
  const px = (pos.lng - r.lng0) * r.kx;
  const py = (pos.lat - r.lat0) * r.ky;
  let best = { cost: Infinity, m: 0, off: Infinity };
  let nearest = { m: 0, off: Infinity };
  for (let i = 1; i < r.coords.length; i++) {
    const ax = r.x[i - 1];
    const ay = r.y[i - 1];
    const vx = r.x[i] - ax;
    const vy = r.y[i] - ay;
    const l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
    const off = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
    const m = r.cum[i - 1] + t * Math.sqrt(l2);
    let cost = off;
    if (lastProgressM !== null) {
      if (m < lastProgressM - 15) cost += 0.5 * (lastProgressM - 15 - m);
      if (m > lastProgressM + 120) cost += 0.3 * (m - lastProgressM - 120);
    }
    if (cost < best.cost) best = { cost, m, off };
    if (off < nearest.off) nearest = { m, off };
  }
  // After a GPS gap the walker can turn up far ahead. When the stretch near their last spot is too far away to
  // be where they are but the route itself is close, they're simply farther along: take the closest spot.
  if (best.off > OFF_ROUTE_M && nearest.off <= OFF_ROUTE_M) best = { cost: nearest.off, ...nearest };
  let m = best.m;
  if (lastProgressM !== null && m < lastProgressM && lastProgressM - m < 10) m = lastProgressM;
  const at = xyAt(r, m);
  const ahead = xyAt(r, Math.min(r.total, m + 3));
  const behind = xyAt(r, Math.max(0, m - 3));
  // Off-route is judged by the true distance to the route, not by the stretch chosen.
  return { progressM: m, snapped: toLngLat(r, at), offM: nearest.off, bearing: bearing(behind, ahead) };
}

export interface Step {
  kind: TurnKind | "arrive";
  inM: number;
}

/** The next thing the walker needs to do, and how far away it is. */
export function nextStep(r: NavRoute, progressM: number): Step {
  const turn = r.turns.find((t) => t.atM > progressM + 2);
  return turn ? { kind: turn.kind, inM: turn.atM - progressM } : { kind: "arrive", inM: Math.max(0, r.total - progressM) };
}

const VERB: Record<Step["kind"], string> = {
  "slight-left": "Bear left",
  left: "Turn left",
  "sharp-left": "Sharp left",
  "slight-right": "Bear right",
  right: "Turn right",
  "sharp-right": "Sharp right",
  "u-turn": "Turn around",
  arrive: "Arrive",
};

/** "Turn left in 60 m", "Turn right now", "Arrive in 120 m". */
export function stepText(step: Step): string {
  if (step.inM < 12) return step.kind === "arrive" ? "You're almost there" : `${VERB[step.kind]} now`;
  return `${VERB[step.kind]} in ${distanceText(step.inM)}`;
}

export function distanceText(m: number): string {
  if (m >= 950) return `${(m / 1000).toFixed(1)} km`;
  return `${m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10} m`;
}

/** The route split at the walker's spot: the part already walked and the part still ahead. */
export function splitRoute(r: NavRoute, progressM: number): { walked: [number, number][]; ahead: [number, number][] } {
  const at = pointAt(r, progressM);
  const i = r.cum.findIndex((c) => c > progressM);
  if (i < 0) return { walked: [...r.coords.slice(0, -1), at], ahead: [] };
  return { walked: [...r.coords.slice(0, i), at], ahead: [at, ...r.coords.slice(i)] };
}
