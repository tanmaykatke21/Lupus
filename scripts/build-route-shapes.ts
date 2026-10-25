// Builds data/route-shapes.json: each bus route's line, taken from a lap the bus actually drove
// (GPS recorded by the poller in Tiger Data) and snapped onto OpenStreetMap roads. Routes with no
// recorded lap fall back to ETA Spot's own shape, snapped the same way.
// Run: `npm run build:shapes` (needs DATABASE_URL; add --refresh to re-download roads).
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import timingFile from "../data/route-timing.json";
import { getRoutes } from "../lib/etaspot";
import { meters } from "../lib/geo";
import type { LngLat } from "../lib/types";

config({ path: [".env.local", ".env"], quiet: true });

const UA = "Lupus-SBUHacks/0.1 (student hackathon project)";
const AREAS = [
  // Campus, LIRR and hospital: every drivable road.
  { file: "data/cache/overpass-roads.json", bbox: "40.8930,-73.1420,40.9260,-73.1040",
    highways: "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|busway" },
  // Off-campus shuttles (Port Jefferson, shopping): through roads only, to keep it small.
  { file: "data/cache/overpass-roads-wide.json", bbox: "40.8500,-73.1700,40.9600,-73.0500",
    highways: "motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link" },
];
const MATCH_RADIUS_M = 35;
const SWITCH_PENALTY_M = 12; // prefer staying on the same or a connected road
const WRONG_WAY_PENALTY_M = 40;

interface Seg { id: number; a: number; b: number; ax: LngLat; bx: LngLat; len: number }
type OsmEl = { type: "node"; id: number; lat: number; lon: number } | { type: "way"; id: number; nodes: number[]; tags: Record<string, string> };

async function loadArea(area: (typeof AREAS)[number]): Promise<OsmEl[]> {
  if (!existsSync(area.file) || process.argv.includes("--refresh")) {
    console.log("downloading roads", area.bbox);
    const q = `[out:json][timeout:120];(way["highway"~"^(${area.highways})$"]["service"!~"^(parking_aisle|driveway|drive-through)$"](${area.bbox}););out body;>;out skel qt;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: q }),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    mkdirSync("data/cache", { recursive: true });
    writeFileSync(area.file, await res.text());
  }
  return JSON.parse(readFileSync(area.file, "utf8")).elements;
}

// --- directed road graph with a segment grid ---
const pos = new Map<number, LngLat>();
const segs: Seg[] = [];
const out = new Map<number, Seg[]>(); // node -> outgoing segments
const grid = new Map<string, Seg[]>();
const CELL = 0.0005;
const cell = (p: LngLat, dx = 0, dy = 0) => `${Math.floor(p[0] / CELL) + dx}:${Math.floor(p[1] / CELL) + dy}`;

function addSeg(a: number, b: number) {
  const s: Seg = { id: segs.length, a, b, ax: pos.get(a)!, bx: pos.get(b)!, len: meters(pos.get(a)!, pos.get(b)!) };
  segs.push(s);
  (out.get(a) ?? out.set(a, []).get(a)!).push(s);
  // Index the segment in every cell it passes through (sampled).
  const n = Math.max(1, Math.ceil(s.len / 25));
  const cells = new Set<string>();
  for (let k = 0; k <= n; k++) cells.add(cell([s.ax[0] + ((s.bx[0] - s.ax[0]) * k) / n, s.ax[1] + ((s.bx[1] - s.ax[1]) * k) / n]));
  for (const c of cells) (grid.get(c) ?? grid.set(c, []).get(c)!).push(s);
}

function buildGraph(elements: OsmEl[]) {
  const seenWays = new Set<number>();
  for (const e of elements) if (e.type === "node") pos.set(e.id, [e.lon, e.lat]);
  for (const e of elements) {
    if (e.type !== "way" || seenWays.has(e.id)) continue;
    seenWays.add(e.id);
    const ow = e.tags.oneway === "yes" || e.tags.junction === "roundabout" ? 1 : e.tags.oneway === "-1" ? -1 : 0;
    for (let i = 1; i < e.nodes.length; i++) {
      const [a, b] = [e.nodes[i - 1], e.nodes[i]];
      if (!pos.has(a) || !pos.has(b)) continue;
      if (ow >= 0) addSeg(a, b);
      if (ow <= 0) addSeg(b, a);
    }
  }
}

// --- matching ---
const k = (lat: number) => Math.cos((lat * Math.PI) / 180);
function project(p: LngLat, s: Seg) {
  const kx = 111_320 * k(p[1]), ky = 110_540;
  const ax = 0, ay = 0, bx = (s.bx[0] - s.ax[0]) * kx, by = (s.bx[1] - s.ax[1]) * ky;
  const px = (p[0] - s.ax[0]) * kx, py = (p[1] - s.ax[1]) * ky;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2)) : 0;
  const pt: LngLat = [s.ax[0] + t * (s.bx[0] - s.ax[0]), s.ax[1] + t * (s.bx[1] - s.ax[1])];
  return { t, pt, d: Math.hypot(px - t * bx, py - t * by) };
}
const bearing = (a: LngLat, b: LngLat) => (Math.atan2((b[0] - a[0]) * k(a[1]), b[1] - a[1]) * 180) / Math.PI;
const angleDiff = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);

/** Shortest road path from node `from` to node `to`, at most `maxLen` meters. */
function roadPath(from: number, to: number, maxLen: number): number[] | null {
  if (from === to) return [from];
  const dist = new Map<number, number>([[from, 0]]), prev = new Map<number, number>();
  const queue: [number, number][] = [[0, from]];
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]);
    const [d, u] = queue.shift()!;
    if (u === to) break;
    if (d > maxLen || d > (dist.get(u) ?? Infinity)) continue;
    for (const s of out.get(u) ?? []) {
      const nd = d + s.len;
      if (nd < (dist.get(s.b) ?? Infinity)) { dist.set(s.b, nd); prev.set(s.b, u); queue.push([nd, s.b]); }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

/** Snap an ordered trace (GPS lap or ETA Spot shape) onto the road graph. */
function match(trace: LngLat[]): LngLat[] {
  const outLine: LngLat[] = [];
  let prev: { s: Seg; pt: LngLat } | null = null;
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    const heading = i > 0 && meters(trace[i - 1], p) > 5 ? bearing(trace[i - 1], p) : null;
    let best: { s: Seg; pt: LngLat; score: number } | null = null;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const s of grid.get(cell(p, dx, dy)) ?? []) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        const pr = project(p, s);
        if (pr.d > MATCH_RADIUS_M) continue;
        let score = pr.d;
        if (prev && s !== prev.s && s.a !== prev.s.b && !(out.get(prev.s.b) ?? []).some(n => n.b === s.a)) score += SWITCH_PENALTY_M;
        if (heading !== null && angleDiff(heading, bearing(s.ax, s.bx)) > 100) score += WRONG_WAY_PENALTY_M;
        if (!best || score < best.score) best = { s, pt: pr.pt, score };
      }
    }
    if (!best) { outLine.push(p); prev = null; continue; } // off the mapped roads: keep the raw point
    if (prev && best.s !== prev.s) {
      const straight = meters(prev.pt, best.pt);
      const path = roadPath(prev.s.b, best.s.a, Math.max(straight * 3, straight + 300));
      if (path) {
        outLine.push(prev.s.bx);
        for (const n of path) outLine.push(pos.get(n)!);
      } else if (straight > 20) {
        continue; // no road connects them (GPS jitter onto the wrong side): drop the point, don't cut across
      }
    }
    outLine.push(best.pt);
    prev = best;
  }
  return roundCorners(simplify(dedupe(outLine), 1.5), 6, 2);
}

/** Cut each corner by up to `maxCutM` (Chaikin-style), so coarse OSM curves draw round, not polygonal. */
function roundCorners(line: LngLat[], maxCutM: number, passes: number): LngLat[] {
  let cur = line;
  for (let p = 0; p < passes; p++) {
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

function dedupe(line: LngLat[]) {
  return line.filter((p, i) => i === 0 || meters(p, line[i - 1]) > 0.5);
}

// Douglas-Peucker in meters.
function simplify(line: LngLat[], tol: number): LngLat[] {
  if (line.length < 3) return line;
  const keep = new Array(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, maxD = tol;
    const seg: Seg = { id: -1, a: 0, b: 0, ax: line[a], bx: line[b], len: 0 };
    for (let i = a + 1; i < b; i++) {
      const d = project(line[i], seg).d;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx !== -1) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

/** Mean and 95th-percentile distance from points to a line (for the accuracy report). */
function fit(points: LngLat[], line: LngLat[]) {
  const ds = points.map(p => {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) best = Math.min(best, project(p, { id: -1, a: 0, b: 0, ax: line[i - 1], bx: line[i], len: 0 }).d);
    return best;
  }).sort((a, b) => a - b);
  return { mean: ds.reduce((s, d) => s + d, 0) / ds.length, p95: ds[Math.floor(ds.length * 0.95)] };
}

async function bestLap(sql: postgres.Sql, routeId: number, firstStop: number, cycleMin: number): Promise<LngLat[] | null> {
  const arr = await sql<{ vehicle_id: string; time: Date }[]>`
    SELECT vehicle_id, time FROM stop_arrivals WHERE route_id = ${routeId} AND stop_id = ${firstStop} ORDER BY vehicle_id, time`;
  let best: { pts: LngLat[]; maxGap: number } | null = null;
  for (let i = 1; i < arr.length; i++) {
    const [a, b] = [arr[i - 1], arr[i]];
    const min = (b.time.getTime() - a.time.getTime()) / 60_000;
    if (a.vehicle_id !== b.vehicle_id || min < cycleMin * 0.7 || min > cycleMin * 1.6) continue;
    const rows = await sql<{ lng: number; lat: number; time: Date }[]>`
      SELECT lng, lat, time FROM vehicle_snapshots WHERE vehicle_id = ${a.vehicle_id} AND in_service AND time BETWEEN ${a.time} AND ${b.time} ORDER BY time`;
    if (rows.length < 20) continue;
    const maxGap = Math.max(...rows.slice(1).map((r, j) => r.time.getTime() - rows[j].time.getTime()));
    if (!best || maxGap < best.maxGap) best = { pts: rows.map(r => [r.lng, r.lat] as LngLat), maxGap };
  }
  return best?.pts ?? null;
}

async function main() {
  for (const area of AREAS) buildGraph(await loadArea(area));
  console.log(`road graph: ${pos.size} nodes, ${segs.length} directed segments`);
  const routes = await getRoutes();
  const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { max: 1 }) : null;
  const previous = existsSync("data/route-shapes.json") ? JSON.parse(readFileSync("data/route-shapes.json", "utf8")).routes : {};
  const result: Record<string, { name: string; source: string; coords: LngLat[] }> = { ...previous };

  for (const r of routes) {
    const cycle = (timingFile.routes as Record<string, { cycleMinutes: number }>)[r.id]?.cycleMinutes ?? 30;
    const lap = sql ? await bestLap(sql, r.id, r.stopIds[0], cycle) : null;
    const trace = lap ?? r.shape;
    // A lap starts and ends at the first stop: finish by matching back to the first point, so the
    // loop closes along the roads instead of with a straight jump across.
    const closes = meters(trace[0], trace[trace.length - 1]) < 80;
    let line = match(closes ? [...trace, trace[0]] : trace);
    // The end may snap a few meters from the start (other side of a two-way road): join them exactly.
    if (closes && meters(line[0], line[line.length - 1]) < 30) line = [...line.slice(0, -1), line[0]];
    const f = fit(trace, line);
    result[r.id] = { name: r.name, source: lap ? `recorded lap (${lap.length} GPS points)` : "ETA Spot shape", coords: line.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]) };
    console.log(`${r.name.padEnd(24)} ${lap ? `lap of ${lap.length} GPS points` : "no recorded lap: ETA Spot shape"} -> ${line.length} points; ` +
      `GPS-to-line distance mean ${f.mean.toFixed(1)} m, 95% within ${f.p95.toFixed(1)} m`);
  }
  await sql?.end();
  writeFileSync("data/route-shapes.json", JSON.stringify({
    builtAt: new Date().toISOString(),
    source: "Bus GPS recorded in Tiger Data, snapped to OpenStreetMap roads (© OpenStreetMap contributors)",
    routes: result,
  }));
  console.log(`wrote data/route-shapes.json (${Math.round(readFileSync("data/route-shapes.json").length / 1024)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
