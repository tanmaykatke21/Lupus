// Walking router over the OSM footway graph plus hand-entered building shortcuts.
import { meters } from "./geo";
import { campusClock, hhmm, type DayKey } from "./time";
import type { LngLat } from "./types";

export const WALK_MPS = 1.3;
export const ACCESSIBLE_WALK_MPS = 1.0;
const FLAG_STAIRS = 1;

export class OutsideMapError extends Error {
  constructor() { super("Point is outside the walking map"); }
}

export interface WalkGraphFile {
  source: string;
  builtAt: string;
  bbox: string;
  nodes: LngLat[];
  // [from, to, lengthMeters, flags, intermediate coords as flat lng,lat pairs]
  edges: [number, number, number, number, number[]][];
}

export interface Shortcut {
  id: string;
  name: string;
  placeholder?: boolean;
  note?: string;
  accessible: boolean;
  entry: LngLat;
  exit: LngLat;
  path?: LngLat[]; // optional interior waypoints
  hours: Partial<Record<DayKey, [string, string] | null>>; // "24:00" = midnight
}

/** A footpath drawn by hand in the /editor (data/custom-paths.json). */
export interface CustomPath {
  id: string;
  name?: string;
  coords: LngLat[];
  stairs: boolean;
}

// Hand-drawn vertices this close to an existing junction become that junction…
const JOIN_M = 12;
// …and loose path ends this close to the network get a short connector to it.
const LINK_M = 30;

export interface WalkOptions {
  accessible?: boolean;
  at?: Date;
}

export interface WalkResult {
  meters: number;
  seconds: number;
  coords: LngLat[];
  shortcuts: { id: string; name: string; note?: string }[];
  stairs: boolean;
}

interface Arc {
  to: number;
  len: number;
  stairs: boolean;
  geom: LngLat[]; // from this node to `to`, excluding both ends
  shortcut?: Shortcut;
}

export function isShortcutOpen(sc: Shortcut, at: Date) {
  const { dayKey, minutes } = campusClock(at);
  const h = sc.hours[dayKey];
  if (!h) return false;
  return minutes >= hhmm(h[0]) && minutes < hhmm(h[1]);
}

// Min-heap of [priority, node].
class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(item: [number, number]) {
    const a = this.a;
    a.push(item);
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

const CELL = 0.002; // ~200 m grid for nearest-node lookup

export class WalkGraph {
  readonly nodes: LngLat[];
  private adj: Arc[][];
  private grid = new Map<string, number[]>();

  constructor(file: WalkGraphFile, readonly shortcuts: Shortcut[] = [], customPaths: CustomPath[] = []) {
    this.nodes = [...file.nodes];
    this.adj = file.nodes.map(() => []);
    for (const [a, b, len, flags, flat] of file.edges) {
      const geom: LngLat[] = [];
      for (let i = 0; i < flat.length; i += 2) geom.push([flat[i], flat[i + 1]]);
      const stairs = (flags & FLAG_STAIRS) !== 0;
      this.adj[a].push({ to: b, len, stairs, geom });
      this.adj[b].push({ to: a, len, stairs, geom: geom.slice().reverse() });
    }
    file.nodes.forEach((n, i) => {
      const k = this.cellKey(n);
      const list = this.grid.get(k);
      if (list) list.push(i); else this.grid.set(k, [i]);
    });
    // Hand-drawn paths first, so shortcuts can attach to them too.
    for (const p of customPaths) this.addCustomPath(p);
    for (const sc of shortcuts) this.addShortcut(sc);
  }

  private addNode(p: LngLat) {
    const i = this.nodes.length;
    this.nodes.push(p);
    this.adj.push([]);
    const k = this.cellKey(p);
    const list = this.grid.get(k);
    if (list) list.push(i); else this.grid.set(k, [i]);
    return i;
  }

  private link(a: number, b: number, stairs: boolean) {
    if (a === b) return;
    const len = meters(this.nodes[a], this.nodes[b]);
    this.adj[a].push({ to: b, len, stairs, geom: [] });
    this.adj[b].push({ to: a, len, stairs, geom: [] });
  }

  private addCustomPath(path: CustomPath) {
    if (path.coords.length < 2) return;
    const ids = path.coords.map(c => {
      const near = this.nearestNode(c);
      return near && near.meters <= JOIN_M ? near.node : this.addNode(c);
    });
    for (let i = 1; i < ids.length; i++) this.link(ids[i - 1], ids[i], path.stairs);
    // Join loose ends to the network if they were drawn slightly short of it.
    for (const end of [0, ids.length - 1]) {
      const node = ids[end];
      if (this.adj[node].length > 1) continue; // already connected beyond this path
      const near = this.nearestOther(path.coords[end], new Set(ids));
      if (near && near.meters <= LINK_M) this.link(node, near.node, false);
    }
  }

  private nearestOther(p: LngLat, exclude: Set<number>) {
    let best = -1, bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of this.grid.get(this.cellKey(p, dx, dy)) ?? []) {
        if (exclude.has(i)) continue;
        const d = meters(p, this.nodes[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best === -1 ? null : { node: best, meters: bestD };
  }

  private cellKey([lng, lat]: LngLat, dx = 0, dy = 0) {
    return `${Math.floor(lng / CELL) + dx}:${Math.floor(lat / CELL) + dy}`;
  }

  nearestNode(p: LngLat) {
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring <= 3 && best === -1; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (const i of this.grid.get(this.cellKey(p, dx, dy)) ?? []) {
            const d = meters(p, this.nodes[i]);
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
    }
    return best === -1 ? null : { node: best, meters: bestD };
  }

  private addShortcut(sc: Shortcut) {
    const a = this.nearestNode(sc.entry), b = this.nearestNode(sc.exit);
    if (!a || !b) return; // shortcut outside the mapped area
    const pts = [this.nodes[a.node], sc.entry, ...(sc.path ?? []), sc.exit, this.nodes[b.node]];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += meters(pts[i - 1], pts[i]);
    const inner = pts.slice(1, -1);
    this.adj[a.node].push({ to: b.node, len, stairs: !sc.accessible, geom: inner, shortcut: sc });
    this.adj[b.node].push({ to: a.node, len, stairs: !sc.accessible, geom: inner.slice().reverse(), shortcut: sc });
  }

  // Dijkstra from a point. `maxMeters` bounds the search for "stops within X m" queries.
  from(origin: LngLat, opts: WalkOptions = {}, maxMeters = Infinity) {
    const at = opts.at ?? new Date();
    const start = this.nearestNode(origin);
    if (!start) throw new OutsideMapError();
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const prevArc: (Arc | null)[] = new Array(this.nodes.length).fill(null);
    const open = new Map<Shortcut, boolean>();
    const heap = new Heap();
    dist[start.node] = start.meters;
    heap.push([start.meters, start.node]);

    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (d > maxMeters) break;
      for (const arc of this.adj[u]) {
        if (opts.accessible && arc.stairs) continue;
        if (arc.shortcut) {
          let isOpen = open.get(arc.shortcut);
          if (isOpen === undefined) open.set(arc.shortcut, (isOpen = isShortcutOpen(arc.shortcut, at)));
          if (!isOpen) continue;
        }
        const nd = d + arc.len;
        if (nd < dist[arc.to]) {
          dist[arc.to] = nd;
          prev[arc.to] = u;
          prevArc[arc.to] = arc;
          heap.push([nd, arc.to]);
        }
      }
    }

    const speed = opts.accessible ? ACCESSIBLE_WALK_MPS : WALK_MPS;
    const nodes = this.nodes;
    const nearest = (p: LngLat) => this.nearestNode(p);
    return {
      /** Walk from the origin to `dest`, or null if unreachable within the search bound. */
      to(dest: LngLat): WalkResult | null {
        const end = nearest(dest);
        if (!end || !Number.isFinite(dist[end.node])) return null;
        const total = dist[end.node] + end.meters;
        const coords: LngLat[] = [dest, nodes[end.node]];
        const shortcuts: WalkResult["shortcuts"] = [];
        let stairs = false;
        for (let v = end.node; prev[v] !== -1; v = prev[v]) {
          const arc = prevArc[v]!;
          for (let i = arc.geom.length - 1; i >= 0; i--) coords.push(arc.geom[i]);
          coords.push(nodes[prev[v]]);
          if (arc.stairs) stairs = true;
          if (arc.shortcut && !shortcuts.some(s => s.id === arc.shortcut!.id)) {
            shortcuts.unshift({ id: arc.shortcut.id, name: arc.shortcut.name, note: arc.shortcut.note });
          }
        }
        coords.push(origin);
        coords.reverse();
        return { meters: total, seconds: total / speed, coords, shortcuts, stairs };
      },
    };
  }

  route(a: LngLat, b: LngLat, opts: WalkOptions = {}) {
    return this.from(a, opts).to(b);
  }
}
