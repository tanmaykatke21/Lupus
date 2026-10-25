// lib/lanes.ts cuts a route into pieces, each drawn with one sideways offset. Where a route changes lane
// (it joins or leaves a shared road) the two pieces end up a few pixels apart and the line looks broken.
// This bridges every such change with a short ramp of tiny pieces whose lanes step from one to the other,
// so the route reads as one continuous line that slides across.
import type { LanePiece } from "./lanes";

type LngLat = [number, number];

/** Length of a lane change, in meters along the road (half on each side of the change). */
const RAMP_M = 40;
/** Largest lane step between neighboring ramp pieces: small enough that their round caps overlap. */
const MAX_STEP = 0.25;

const metersPerDeg = (lat: number) => [111_320 * Math.cos((lat * Math.PI) / 180), 110_540] as const;
function dist(a: LngLat, b: LngLat) {
  const [kx, ky] = metersPerDeg(a[1]);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
}
const length = (line: LngLat[]) => line.slice(1).reduce((sum, p, i) => sum + dist(line[i], p), 0);
const lerp = (a: LngLat, b: LngLat, t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Cut a line at `m` meters from its start: [before, after], both containing the cut point. */
function cut(line: LngLat[], m: number): [LngLat[], LngLat[]] {
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const d = dist(line[i - 1], line[i]);
    if (walked + d >= m) {
      const p = d === 0 ? line[i] : lerp(line[i - 1], line[i], (m - walked) / d);
      return [[...line.slice(0, i), p], [p, ...line.slice(i)]];
    }
    walked += d;
  }
  return [line, [line[line.length - 1]]];
}

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

export interface LaneZone {
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * Inside each zone every route is drawn in lane 0, bundled down the middle of the road: for tight terminals
 * where side-by-side lanes don't fit (data/lane-zones.json). joinLanes then ramps routes in and out of it.
 */
export function bundleZones<P extends LanePiece>(pieces: P[], zones: LaneZone[]): P[] {
  if (!zones.length) return pieces;
  const inside = (p: LngLat) => zones.some(z => dist(p, [z.lng, z.lat]) <= z.radiusM);
  const out: P[] = [];
  for (const p of pieces) {
    const coords = p.coords as LngLat[];
    const isIn = coords.map(inside);
    // A step is in the zone when both its ends are; cut the piece wherever that changes.
    const stepIn = (k: number) => isIn[k] && isIn[k + 1];
    let start = 0;
    for (let k = 0; k < coords.length - 1; k++) {
      if (k === coords.length - 2 || stepIn(k + 1) !== stepIn(k)) {
        const part = coords.slice(start, k + 2);
        if (part.length > 1) out.push({ ...p, coords: part, lane: stepIn(k) ? 0 : p.lane });
        start = k + 1;
      }
    }
  }
  return out;
}

export function joinLanes<P extends LanePiece>(pieces: P[]): P[] {
  const out: P[] = [];
  // Each piece, trimmed where ramps take over its ends.
  const trimmed = pieces.map(p => ({ ...p, coords: p.coords as LngLat[] }));
  for (let k = 0; k < trimmed.length; k++) {
    const a = trimmed[k];
    const b = trimmed[k + 1];
    const joins = b && b.id === a.id && b.lane !== a.lane && same(a.coords[a.coords.length - 1], b.coords[0]);
    if (!joins) {
      out.push(a as P);
      continue;
    }
    // Take up to half a ramp from each side, but never more than half a piece (it may need a ramp at its other end too).
    const lenA = length(a.coords);
    const lenB = length(b.coords);
    const takeA = Math.min(RAMP_M / 2, lenA / 2);
    const takeB = Math.min(RAMP_M / 2, lenB / 2);
    const [keepA, tailA] = cut(a.coords, lenA - takeA);
    const [headB, keepB] = cut(b.coords, takeB);
    if (keepA.length > 1) out.push({ ...a, coords: keepA } as P);
    const ramp = [...tailA, ...headB.slice(1)];
    const rampLen = takeA + takeB;
    const steps = Math.max(2, Math.ceil(Math.abs(b.lane - a.lane) / MAX_STEP));
    let rest = ramp;
    for (let s = 0; s < steps; s++) {
      const [piece, after] = s === steps - 1 ? [rest, rest] : cut(rest, rampLen / steps);
      if (piece.length > 1) out.push({ ...a, lane: a.lane + ((b.lane - a.lane) * (s + 0.5)) / steps, coords: piece } as P);
      rest = after;
    }
    trimmed[k + 1] = { ...b, coords: keepB };
  }
  return out;
}

export interface LaneChain {
  id: number;
  coords: LngLat[];
  /** Lane at each point of `coords`. */
  lanes: number[];
}

/**
 * Consecutive pieces of the same route that touch, as one line with a lane per point. Drawn as a single
 * stroke there are no overlapping ends where a lane changes, which would show as darker dots on a faded line.
 */
export function chainLanes(pieces: LanePiece[]): LaneChain[] {
  const out: LaneChain[] = [];
  for (const p of pieces) {
    const coords = p.coords as LngLat[];
    const last = out[out.length - 1];
    if (last && last.id === p.id && same(last.coords[last.coords.length - 1], coords[0])) {
      // The shared point sits between both lanes.
      last.lanes[last.lanes.length - 1] = (last.lanes[last.lanes.length - 1] + p.lane) / 2;
      last.coords.push(...coords.slice(1));
      last.lanes.push(...coords.slice(1).map(() => p.lane));
    } else {
      out.push({ id: p.id, coords: [...coords], lanes: coords.map(() => p.lane) });
    }
  }
  return out;
}
