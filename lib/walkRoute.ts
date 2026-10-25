// Walking directions over the campus path network in data/walkways.json (built by
// scripts/build-walkways.mjs from OpenStreetMap). Each end of the trip is snapped to the nearest point on a
// path, then A* finds the shortest walk between them, guided by the straight-line distance still to go.

import type { LatLng } from "./geo";

export interface WalkData {
  version: number;
  /** [lng, lat] pairs in millionths of a degree, flattened. */
  nodes: number[];
  /** Pairs of node indexes joined by a walkable path, flattened. */
  edges: number[];
}

export interface WalkGraph {
  x: Float64Array; // meters east of the origin
  y: Float64Array; // meters north of the origin
  lng: Float64Array;
  lat: Float64Array;
  /** Adjacency: neighbors of node i are to[off[i]..off[i+1]), with lengths len[...]. */
  off: Int32Array;
  to: Int32Array;
  len: Float64Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  /** Edge indexes by grid cell, for snapping a point to the nearest path. */
  cells: Map<string, number[]>;
  lng0: number;
  lat0: number;
  kx: number;
  ky: number;
}

export interface WalkPath {
  /** [lng, lat] from the start to the destination, following paths. */
  coords: [number, number][];
  /** Indexes into `coords` where three or more paths meet: the only places a walker has to choose a way. */
  junctions: number[];
  meters: number;
}

/** Farther than this from every path, a point is off the map we have; the caller falls back. */
export const MAX_SNAP_M = 400;
const CELL_M = 75;

export function buildWalkGraph(data: WalkData): WalkGraph | null {
  const n = Math.floor(data.nodes.length / 2);
  const m = Math.floor(data.edges.length / 2);
  if (n < 2 || m < 1) return null;

  const lng = new Float64Array(n);
  const lat = new Float64Array(n);
  let latSum = 0;
  for (let i = 0; i < n; i++) {
    lng[i] = data.nodes[2 * i] / 1e6;
    lat[i] = data.nodes[2 * i + 1] / 1e6;
    latSum += lat[i];
  }
  const lat0 = latSum / n;
  const lng0 = lng[0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (lng[i] - lng0) * kx;
    y[i] = (lat[i] - lat0) * ky;
  }

  const edgeA = new Int32Array(m);
  const edgeB = new Int32Array(m);
  const degree = new Int32Array(n);
  for (let e = 0; e < m; e++) {
    edgeA[e] = data.edges[2 * e];
    edgeB[e] = data.edges[2 * e + 1];
    degree[edgeA[e]]++;
    degree[edgeB[e]]++;
  }
  const off = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + degree[i];
  const fill = off.slice(0, n);
  const to = new Int32Array(2 * m);
  const len = new Float64Array(2 * m);
  const cells = new Map<string, number[]>();
  for (let e = 0; e < m; e++) {
    const a = edgeA[e];
    const b = edgeB[e];
    const d = Math.hypot(x[b] - x[a], y[b] - y[a]);
    to[fill[a]] = b;
    len[fill[a]++] = d;
    to[fill[b]] = a;
    len[fill[b]++] = d;
    // Index the edge in every cell its bounding box touches.
    const x0 = Math.floor(Math.min(x[a], x[b]) / CELL_M);
    const x1 = Math.floor(Math.max(x[a], x[b]) / CELL_M);
    const y0 = Math.floor(Math.min(y[a], y[b]) / CELL_M);
    const y1 = Math.floor(Math.max(y[a], y[b]) / CELL_M);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx},${cy}`;
        const list = cells.get(k);
        if (list) list.push(e);
        else cells.set(k, [e]);
      }
  }
  return { x, y, lng, lat, off, to, len, edgeA, edgeB, cells, lng0, lat0, kx, ky };
}

interface Snap {
  edge: number;
  /** Where along the edge, 0 at edgeA and 1 at edgeB. */
  t: number;
  px: number;
  py: number;
  /** Straight distance from the point to the path. */
  dist: number;
}

function snap(g: WalkGraph, px: number, py: number): Snap | null {
  let best: Snap | null = null;
  const cx = Math.floor(px / CELL_M);
  const cy = Math.floor(py / CELL_M);
  const reach = Math.ceil(MAX_SNAP_M / CELL_M);
  // Search outward ring by ring; stop once the ring is farther away than the best match found.
  for (let r = 0; r <= reach; r++) {
    if (best && (r - 1) * CELL_M > best.dist) break;
    for (let gx = cx - r; gx <= cx + r; gx++)
      for (let gy = cy - r; gy <= cy + r; gy++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue; // ring only
        for (const e of g.cells.get(`${gx},${gy}`) ?? []) {
          const a = g.edgeA[e];
          const b = g.edgeB[e];
          const vx = g.x[b] - g.x[a];
          const vy = g.y[b] - g.y[a];
          const l2 = vx * vx + vy * vy;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - g.x[a]) * vx + (py - g.y[a]) * vy) / l2));
          const qx = g.x[a] + t * vx;
          const qy = g.y[a] + t * vy;
          const dist = Math.hypot(px - qx, py - qy);
          if (!best || dist < best.dist) best = { edge: e, t, px: qx, py: qy, dist };
        }
      }
  }
  return best && best.dist <= MAX_SNAP_M ? best : null;
}

/** A binary min-heap of node indexes keyed by priority. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): [number, number] {
    const { ids, keys } = this;
    const top: [number, number] = [ids[0], keys[0]];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= ids.length) break;
        const c = l + 1 < ids.length && keys[l + 1] < keys[l] ? l + 1 : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/**
 * The shortest walk from `from` to `to` along paths, or null when either end is more than MAX_SNAP_M from
 * every path (or the two can't be joined). Distance includes the short straight bits from each end onto
 * its path.
 */
export function walkRoute(g: WalkGraph, from: LatLng, to: LatLng): WalkPath | null {
  const fx = (from.lng - g.lng0) * g.kx;
  const fy = (from.lat - g.lat0) * g.ky;
  const tx = (to.lng - g.lng0) * g.kx;
  const ty = (to.lat - g.lat0) * g.ky;
  const s = snap(g, fx, fy);
  const d = snap(g, tx, ty);
  if (!s || !d) return null;
  const toLngLat = (x: number, y: number): [number, number] => [g.lng0 + x / g.kx, g.lat0 + y / g.ky];
  const edgeLen = (e: number) => Math.hypot(g.x[g.edgeB[e]] - g.x[g.edgeA[e]], g.y[g.edgeB[e]] - g.y[g.edgeA[e]]);

  // Both ends on the same stretch of path: walk straight along it.
  let bestCost = Infinity;
  let bestEnd = -1;
  if (s.edge === d.edge) {
    bestCost = Math.abs(s.t - d.t) * edgeLen(s.edge);
  }

  const n = g.x.length;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // Remaining straight-line distance to the destination's point on the path: never more than the real walk,
  // so A* still finds the shortest route.
  const h = (i: number) => Math.hypot(g.x[i] - d.px, g.y[i] - d.py);
  const heap = new Heap();
  const sLen = edgeLen(s.edge);
  for (const [node, c] of [
    [g.edgeA[s.edge], s.t * sLen],
    [g.edgeB[s.edge], (1 - s.t) * sLen],
  ] as const) {
    if (c < cost[node]) {
      cost[node] = c;
      heap.push(node, c + h(node));
    }
  }
  const dLen = edgeLen(d.edge);
  const tail = new Map<number, number>([
    [g.edgeA[d.edge], d.t * dLen],
    [g.edgeB[d.edge], (1 - d.t) * dLen],
  ]);
  if (g.edgeA[d.edge] === g.edgeB[d.edge]) tail.set(g.edgeA[d.edge], 0);

  while (heap.size) {
    const [u, f] = heap.pop();
    if (done[u]) continue;
    if (f >= bestCost) break; // nothing left can beat the best route found
    done[u] = 1;
    const last = tail.get(u);
    if (last !== undefined && cost[u] + last < bestCost) {
      bestCost = cost[u] + last;
      bestEnd = u;
    }
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const v = g.to[k];
      const c = cost[u] + g.len[k];
      if (c < cost[v]) {
        cost[v] = c;
        prev[v] = u;
        heap.push(v, c + h(v));
      }
    }
  }
  if (!Number.isFinite(bestCost)) return null;

  const points: { c: [number, number]; junction: boolean }[] = [
    { c: [from.lng, from.lat], junction: false },
    { c: toLngLat(s.px, s.py), junction: false },
  ];
  if (bestEnd >= 0) {
    const chain: number[] = [];
    for (let v = bestEnd; v >= 0; v = prev[v]) chain.push(v);
    chain.reverse();
    for (const v of chain) points.push({ c: [g.lng[v], g.lat[v]], junction: g.off[v + 1] - g.off[v] >= 3 });
  }
  points.push({ c: toLngLat(d.px, d.py), junction: false }, { c: [to.lng, to.lat], junction: false });

  // Drop repeated points (an end exactly on a path, or a snap onto a node), keeping junction marks.
  const coords: [number, number][] = [];
  const junctions: number[] = [];
  for (const p of points) {
    const last = coords[coords.length - 1];
    const same = last && Math.abs(p.c[0] - last[0]) <= 1e-7 && Math.abs(p.c[1] - last[1]) <= 1e-7;
    if (!same) coords.push(p.c);
    if (p.junction && junctions[junctions.length - 1] !== coords.length - 1) junctions.push(coords.length - 1);
  }
  return { coords, junctions, meters: bestCost + s.dist + d.dist };
}
