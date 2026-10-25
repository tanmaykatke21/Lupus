// How bus routes are drawn: no lanes or sideways offsets (they folded into loops on tight turns).
// Each route is cut into pieces. Where two or more routes use the same road (either direction), that
// stretch is drawn once, in one neutral "shared" color; where a route runs alone it keeps its own color.
import type { LngLat } from "./types";

/** Color for road stretches several routes share (brass, matches the theme). */
export const SHARED_COLOR = "#b8862b";

export interface RoutePiece {
  coords: LngLat[];
  color: string;
  /** Routes using this piece (one for a route's own stretch, several for a shared one). */
  routeIds: number[];
}

interface Input { id: number; color: string; shape: LngLat[] }

const SHARE_M = 15; // closer than this and parallel = the same road
const PARALLEL = 0.85; // |cos| of the angle between directions (either direction counts)
const STEP_M = 15;
const CELL_M = 40;
const MIN_RUN = 5; // stretches shorter than this many steps (~75 m) take their neighbor's kind
const MIN_PIECE_M = 15; // never draw a piece shorter than this (a stray dash)

function pathLength(line: LngLat[]) {
  let m = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    m += Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110_540);
  }
  return m;
}

interface Step { r: number; i: number; ax: number; ay: number; bx: number; by: number; mx: number; my: number; dx: number; dy: number }

function distToStep(px: number, py: number, s: Step) {
  const vx = s.bx - s.ax, vy = s.by - s.ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - s.ax) * vx + (py - s.ay) * vy) / len2)) : 0;
  return Math.hypot(px - (s.ax + t * vx), py - (s.ay + t * vy));
}

export function routePieces(routes: Input[]): RoutePiece[] {
  const usable = routes.filter(r => r.shape.length >= 2);
  if (!usable.length) return [];
  const lat0 = usable[0].shape[0][1], lng0 = usable[0].shape[0][0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;

  // Densify into short steps so sharing can start and stop mid-stretch.
  const points: LngLat[][] = usable.map(r => {
    const out: LngLat[] = [r.shape[0]];
    for (let k = 1; k < r.shape.length; k++) {
      const [a, b] = [r.shape[k - 1], r.shape[k]];
      const len = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
      if (len < 0.5) continue;
      const n = Math.max(1, Math.ceil(len / STEP_M));
      for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
    }
    return out;
  });
  const steps: Step[][] = points.map((pts, r) => pts.slice(1).map((b, i) => {
    const a = pts[i];
    const ax = (a[0] - lng0) * kx, ay = (a[1] - lat0) * ky, bx = (b[0] - lng0) * kx, by = (b[1] - lat0) * ky;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return { r, i, ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2, dx: (bx - ax) / len, dy: (by - ay) / len };
  }));
  const grid = new Map<string, Step[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`;
  for (const list of steps) for (const s of list) {
    const k = key(s.mx, s.my);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
  }

  // Per step: the nearest step of each other route running along the same road here.
  const partners: Map<number, number>[][] = steps.map(list => list.map(s => {
    const near = new Map<number, { i: number; d: number }>();
    const cx = Math.floor(s.mx / CELL_M), cy = Math.floor(s.my / CELL_M);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const o of grid.get(`${gx},${gy}`) ?? []) {
        if (o.r === s.r || Math.abs(o.dx * s.dx + o.dy * s.dy) < PARALLEL) continue;
        const d = distToStep(s.mx, s.my, o);
        if (d > SHARE_M) continue;
        const cur = near.get(o.r);
        if (!cur || d < cur.d) near.set(o.r, { i: o.i, d });
      }
    }
    return new Map([...near].map(([r, v]) => [r, v.i]));
  }));

  // Shared or not, per step. Slivers (a route wobbling off a shared road, or brushing past another
  // at a junction) are absorbed into their neighbor; then both routes must agree a stretch is shared,
  // so one never draws a shared dash where the other draws its own color.
  const shared = partners.map(row => row.map(p => p.size > 0));
  const absorbSlivers = (row: boolean[]) => {
    for (let start = 0; start < row.length;) {
      let end = start;
      while (end + 1 < row.length && row[end + 1] === row[start]) end++;
      const neighbor = start > 0 ? row[start - 1] : end + 1 < row.length ? row[end + 1] : undefined;
      if (end - start + 1 < MIN_RUN && neighbor !== undefined) for (let k = start; k <= end; k++) row[k] = neighbor;
      start = end + 1;
    }
  };
  const agreed = (ri: number, si: number) => [...partners[ri][si]].filter(([rj, sj]) => shared[rj][sj]);
  for (let round = 0; round < 2; round++) {
    shared.forEach(absorbSlivers);
    shared.forEach((row, ri) => row.forEach((v, si) => { if (v && !agreed(ri, si).length) row[si] = false; }));
  }

  const pieces: RoutePiece[] = [];
  usable.forEach((route, ri) => {
    // 0 = the route's own stretch, 1 = shared and drawn by this route, 2 = shared and drawn by another.
    // A shared stretch is drawn by the lowest-id route on it, so it appears exactly once.
    const others = shared[ri].map((v, si) => (v ? agreed(ri, si).map(([rj]) => usable[rj].id).sort((a, b) => a - b) : []));
    const kind = others.map(ids => (ids.length === 0 ? 0 : route.id < ids[0] ? 1 : 2));
    // Where three routes overlap partly, who draws can flip every few meters: smooth that too.
    for (let start = 0; start < kind.length;) {
      let end = start;
      while (end + 1 < kind.length && kind[end + 1] === kind[start]) end++;
      const neighbor = start > 0 ? kind[start - 1] : end + 1 < kind.length ? kind[end + 1] : undefined;
      if (end - start + 1 < MIN_RUN && neighbor !== undefined) for (let k = start; k <= end; k++) kind[k] = neighbor;
      start = end + 1;
    }
    for (let start = 0; start < kind.length;) {
      let end = start;
      while (end + 1 < kind.length && kind[end + 1] === kind[start]) end++;
      const coords = points[ri].slice(start, end + 2);
      if (kind[start] !== 2 && pathLength(coords) >= MIN_PIECE_M) {
        pieces.push({
          coords,
          color: kind[start] === 0 ? route.color : SHARED_COLOR,
          routeIds: kind[start] === 0 ? [route.id] : [route.id, ...others[start]],
        });
      }
      start = end + 1;
    }
  });
  return pieces;
}
