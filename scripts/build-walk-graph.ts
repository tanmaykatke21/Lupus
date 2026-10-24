// Builds data/walk-graph.json from OpenStreetMap (Overpass) footways around campus,
// the LIRR station and the hospital. Run once: `npm run build:walk` (add --refresh to re-download).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { meters } from "../lib/geo";
import type { WalkGraphFile } from "../lib/walk";

const BBOX = "40.8930,-73.1420,40.9260,-73.1040"; // S,W,N,E
const CACHE = "data/cache/overpass-walk.json";
const OUT = "data/walk-graph.json";
const HIGHWAYS = "footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|secondary|track|cycleway|corridor";

const QUERY = `[out:json][timeout:90];
(way["highway"~"^(${HIGHWAYS})$"]["access"!~"^(private|no)$"]["foot"!="no"](${BBOX}););
out body;>;out skel qt;`;

interface OsmNode { type: "node"; id: number; lat: number; lon: number }
interface OsmWay { type: "way"; id: number; nodes: number[]; tags: Record<string, string> }

async function load(): Promise<(OsmNode | OsmWay)[]> {
  if (existsSync(CACHE) && !process.argv.includes("--refresh")) {
    return JSON.parse(readFileSync(CACHE, "utf8")).elements;
  }
  console.log("downloading from Overpass…");
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    // Overpass rejects requests without a User-Agent (HTTP 406).
    headers: { "User-Agent": "Lupus-SBUHacks/0.1 (student hackathon project)", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  const text = await res.text();
  mkdirSync("data/cache", { recursive: true });
  writeFileSync(CACHE, text);
  return JSON.parse(text).elements;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

async function main() {
  const elements = await load();
  const pos = new Map<number, [number, number]>();
  const ways: OsmWay[] = [];
  for (const e of elements) {
    if (e.type === "node") pos.set(e.id, [round(e.lon), round(e.lat)]);
    else ways.push(e);
  }

  // Junctions: nodes shared by ways, plus way endpoints. Edges run junction to junction.
  const uses = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes) uses.set(n, (uses.get(n) ?? 0) + 1);
  const isJunction = (w: OsmWay, i: number) => i === 0 || i === w.nodes.length - 1 || (uses.get(w.nodes[i]) ?? 0) > 1;

  const index = new Map<number, number>();
  const nodes: [number, number][] = [];
  const idx = (osmId: number) => {
    let i = index.get(osmId);
    if (i === undefined) { i = nodes.length; nodes.push(pos.get(osmId)!); index.set(osmId, i); }
    return i;
  };

  type Edge = WalkGraphFile["edges"][number];
  let edges: Edge[] = [];
  for (const w of ways) {
    const stairs = w.tags.highway === "steps" ? 1 : 0;
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (!isJunction(w, i)) continue;
      const seg = w.nodes.slice(start, i + 1).filter(n => pos.has(n));
      if (seg.length >= 2) {
        let len = 0;
        for (let k = 1; k < seg.length; k++) len += meters(pos.get(seg[k - 1])!, pos.get(seg[k])!);
        const mid = seg.slice(1, -1).flatMap(n => pos.get(n)!);
        edges.push([idx(seg[0]), idx(seg[seg.length - 1]), Math.round(len * 10) / 10, stairs, mid]);
      }
      start = i;
    }
  }

  // Keep the largest connected component so origins never snap onto an island.
  const adj: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const comp = new Int32Array(nodes.length).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of adj[u]) if (comp[v] === -1) { comp[v] = id; stack.push(v); }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const keep = new Map<number, number>();
  const keptNodes: [number, number][] = [];
  nodes.forEach((n, i) => { if (comp[i] === main) { keep.set(i, keptNodes.length); keptNodes.push(n); } });
  edges = edges.filter(([a]) => comp[a] === main).map(([a, b, len, f, mid]) => [keep.get(a)!, keep.get(b)!, len, f, mid]);

  const out: WalkGraphFile = {
    source: "© OpenStreetMap contributors (ODbL), via Overpass API",
    builtAt: new Date().toISOString(),
    bbox: BBOX,
    nodes: keptNodes,
    edges,
  };
  writeFileSync(OUT, JSON.stringify(out));
  const kb = Math.round(JSON.stringify(out).length / 1024);
  console.log(`${keptNodes.length} nodes, ${edges.length} edges (${edges.filter(e => e[3] & 1).length} stairs), ` +
    `dropped ${nodes.length - keptNodes.length} island nodes → ${OUT} (${kb} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
