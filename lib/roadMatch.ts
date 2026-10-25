// Snaps ETA Spot's coarse route lines onto real roads (OpenStreetMap), so they follow the street
// instead of cutting chords across loops and intersections. Parts outside the mapped area stay as-is.
import { meters } from "./geo";
import type { LngLat } from "./types";

export interface RoadGraphFile {
  source: string;
  bbox: string;
  nodes: LngLat[];
  segs: number[]; // directed segments as flat [from, to, from, to, …]
}

interface Seg { id: number; a: number; b: number; ax: LngLat; bx: LngLat; len: number }

const MATCH_RADIUS_M = 30;
const SWITCH_PENALTY_M = 12; // prefer staying on the same or a connected road
const WRONG_WAY_PENALTY_M = 40;
const DENSIFY_M = 10;
const CELL = 0.0005;

const kLat = (lat: number) => Math.cos((lat * Math.PI) / 180);
const bearing = (a: LngLat, b: LngLat) => (Math.atan2((b[0] - a[0]) * kLat(a[1]), b[1] - a[1]) * 180) / Math.PI;
const angleDiff = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);

function project(p: LngLat, ax: LngLat, bx: LngLat) {
  const kx = 111_320 * kLat(p[1]), ky = 110_540;
  const vx = (bx[0] - ax[0]) * kx, vy = (bx[1] - ax[1]) * ky;
  const px = (p[0] - ax[0]) * kx, py = (p[1] - ax[1]) * ky;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0;
  return { pt: [ax[0] + t * (bx[0] - ax[0]), ax[1] + t * (bx[1] - ax[1])] as LngLat, d: Math.hypot(px - t * vx, py - t * vy) };
}

export function densify(line: LngLat[], step = DENSIFY_M): LngLat[] {
  const out: LngLat[] = line.length ? [line[0]] : [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const n = Math.max(1, Math.ceil(meters(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const SPUR_RETURN_M = 6;
const SPUR_MAX_LEN_M = 100;

/**
 * Removes short detours that come straight back (snapping briefly onto a cross street at a junction):
 * if the line returns within a few meters of a point after a short excursion, cut the excursion.
 * Real loops are longer (the SAC turnaround alone is ~160 m around) and are kept.
 */
export function removeSpurs(line: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < line.length; i++) {
    out.push(line[i]);
    let walked = 0;
    for (let j = i + 1; j < line.length; j++) {
      walked += meters(line[j - 1], line[j]);
      if (walked > SPUR_MAX_LEN_M) break;
      if (j - i >= 2 && walked > 3 * SPUR_RETURN_M && meters(line[i], line[j]) < SPUR_RETURN_M) {
        i = j; // skip the excursion; line[j] is next to line[i] anyway
        break;
      }
    }
  }
  return out;
}

/** Douglas-Peucker in meters. */
export function simplify(line: LngLat[], tol: number): LngLat[] {
  if (line.length < 3) return line;
  const keep = new Array(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, maxD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = project(line[i], line[a], line[b]).d;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx !== -1) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

/** Cut each corner by up to `maxCutM` (Chaikin-style) so coarse OSM curves draw round. */
export function roundCorners(line: LngLat[], maxCutM = 6, passes = 2): LngLat[] {
  let cur = line;
  for (let p = 0; p < passes; p++) {
    if (cur.length < 3) return cur;
    const next: LngLat[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const [a, b, c] = [cur[i - 1], cur[i], cur[i + 1]];
      const t1 = Math.min(0.25, maxCutM / Math.max(meters(a, b), 1e-6));
      const t2 = Math.min(0.25, maxCutM / Math.max(meters(b, c), 1e-6));
      next.push([b[0] + (a[0] - b[0]) * t1, b[1] + (a[1] - b[1]) * t1], [b[0] + (c[0] - b[0]) * t2, b[1] + (c[1] - b[1]) * t2]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

// Min-heap for Dijkstra.
class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(x: [number, number]) {
    const a = this.a;
    a.push(x);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class RoadGraph {
  private segs: Seg[] = [];
  private out = new Map<number, Seg[]>();
  private grid = new Map<string, Seg[]>();

  constructor(private file: RoadGraphFile) {
    for (let i = 0; i < file.segs.length; i += 2) {
      const a = file.segs[i], b = file.segs[i + 1];
      const s: Seg = { id: this.segs.length, a, b, ax: file.nodes[a], bx: file.nodes[b], len: meters(file.nodes[a], file.nodes[b]) };
      this.segs.push(s);
      (this.out.get(a) ?? this.out.set(a, []).get(a)!).push(s);
      const n = Math.max(1, Math.ceil(s.len / 25));
      const cells = new Set<string>();
      for (let k = 0; k <= n; k++) cells.add(this.cell([s.ax[0] + ((s.bx[0] - s.ax[0]) * k) / n, s.ax[1] + ((s.bx[1] - s.ax[1]) * k) / n]));
      for (const c of cells) (this.grid.get(c) ?? this.grid.set(c, []).get(c)!).push(s);
    }
  }

  private cell(p: LngLat, dx = 0, dy = 0) {
    return `${Math.floor(p[0] / CELL) + dx}:${Math.floor(p[1] / CELL) + dy}`;
  }

  private path(from: number, to: number, maxLen: number): number[] | null {
    if (from === to) return [from];
    const dist = new Map<number, number>([[from, 0]]), prev = new Map<number, number>();
    const heap = new Heap();
    heap.push([0, from]);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (u === to) break;
      if (d > maxLen || d > (dist.get(u) ?? Infinity)) continue;
      for (const s of this.out.get(u) ?? []) {
        const nd = d + s.len;
        if (nd < (dist.get(s.b) ?? Infinity)) { dist.set(s.b, nd); prev.set(s.b, u); heap.push([nd, s.b]); }
      }
    }
    if (!dist.has(to)) return null;
    const p = [to];
    while (p[0] !== from) p.unshift(prev.get(p[0])!);
    return p;
  }

  /** Snap a route line onto the roads. Points with no road within 30 m are kept as they are. */
  match(line: LngLat[]): LngLat[] {
    const trace = densify(line);
    const out: LngLat[] = [];
    let prev: { s: Seg; pt: LngLat } | null = null;
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i];
      const heading = i > 0 ? bearing(trace[i - 1], p) : null;
      let best: { s: Seg; pt: LngLat; score: number } | null = null;
      const seen = new Set<number>();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const s of this.grid.get(this.cell(p, dx, dy)) ?? []) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          const pr = project(p, s.ax, s.bx);
          if (pr.d > MATCH_RADIUS_M) continue;
          let score = pr.d;
          if (prev && s !== prev.s && s.a !== prev.s.b && !(this.out.get(prev.s.b) ?? []).some(n => n.b === s.a)) score += SWITCH_PENALTY_M;
          if (heading !== null && angleDiff(heading, bearing(s.ax, s.bx)) > 100) score += WRONG_WAY_PENALTY_M;
          if (!best || score < best.score) best = { s, pt: pr.pt, score };
        }
      }
      if (!best) { out.push(p); prev = null; continue; } // outside the mapped roads
      if (prev && best.s !== prev.s) {
        const straight = meters(prev.pt, best.pt);
        const route = this.path(prev.s.b, best.s.a, Math.max(straight * 3, straight + 300));
        if (route) {
          out.push(prev.s.bx);
          for (const n of route) out.push(this.file.nodes[n]);
        } else if (straight > 20) {
          continue; // no road connects them: drop the point rather than cut across
        }
      }
      out.push(best.pt);
      prev = best;
    }
    const clean = out.filter((p, i) => i === 0 || meters(p, out[i - 1]) > 0.5);
    let result = roundCorners(simplify(removeSpurs(clean), 1.5));
    // Loops: ETA Spot lines start and end at the first stop; join the ends exactly.
    if (result.length > 2 && meters(result[0], result[result.length - 1]) < 30) result = [...result.slice(0, -1), result[0]];
    return result.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as LngLat);
  }
}
