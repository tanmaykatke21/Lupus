// Builds data/road-graph.json: drivable campus roads from OpenStreetMap, as a compact directed graph.
// The server snaps ETA Spot's coarse route lines onto it (lib/roadMatch.ts). Run: `npm run build:roads`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { RoadGraphFile } from "../lib/roadMatch";

const CACHE = "data/cache/overpass-roads.json";
const BBOX = "40.8930,-73.1420,40.9260,-73.1040"; // campus, LIRR, hospital
const HIGHWAYS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|busway";

type OsmEl = { type: "node"; id: number; lat: number; lon: number } | { type: "way"; id: number; nodes: number[]; tags: Record<string, string> };

async function load(): Promise<OsmEl[]> {
  if (!existsSync(CACHE) || process.argv.includes("--refresh")) {
    const q = `[out:json][timeout:90];(way["highway"~"^(${HIGHWAYS})$"]["service"!~"^(parking_aisle|driveway|drive-through)$"](${BBOX}););out body;>;out skel qt;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": "Lupus-SBUHacks/0.1 (student hackathon project)", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: q }),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    mkdirSync("data/cache", { recursive: true });
    writeFileSync(CACHE, await res.text());
  }
  return JSON.parse(readFileSync(CACHE, "utf8")).elements;
}

async function main() {
  const els = await load();
  const pos = new Map<number, [number, number]>();
  for (const e of els) if (e.type === "node") pos.set(e.id, [Math.round(e.lon * 1e6) / 1e6, Math.round(e.lat * 1e6) / 1e6]);
  const index = new Map<number, number>();
  const nodes: [number, number][] = [];
  const idx = (id: number) => {
    let i = index.get(id);
    if (i === undefined) { i = nodes.length; nodes.push(pos.get(id)!); index.set(id, i); }
    return i;
  };
  const segs: number[] = [];
  for (const e of els) {
    if (e.type !== "way") continue;
    const oneway = e.tags.oneway === "yes" || e.tags.junction === "roundabout" ? 1 : e.tags.oneway === "-1" ? -1 : 0;
    for (let i = 1; i < e.nodes.length; i++) {
      const [a, b] = [e.nodes[i - 1], e.nodes[i]];
      if (!pos.has(a) || !pos.has(b)) continue;
      if (oneway >= 0) segs.push(idx(a), idx(b));
      if (oneway <= 0) segs.push(idx(b), idx(a));
    }
  }
  const out: RoadGraphFile = { source: "© OpenStreetMap contributors (ODbL)", bbox: BBOX, nodes, segs };
  writeFileSync("data/road-graph.json", JSON.stringify(out));
  console.log(`${nodes.length} nodes, ${segs.length / 2} directed segments → data/road-graph.json (${Math.round(JSON.stringify(out).length / 1024)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
