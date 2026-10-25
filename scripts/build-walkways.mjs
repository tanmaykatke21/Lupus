// Download the campus walking network (footpaths, sidewalks, stairs, walkable streets) from OpenStreetMap
// and write it as a compact graph to data/walkways.json, which Lupus uses for walking directions.
// Run on a machine that can reach the Overpass API:  npm run build:walkways
//   --refresh        download again instead of reusing data/cache/osm-walkways.json
//   --input <file>   build from a saved Overpass response instead of downloading
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheFile = join(root, "data", "cache", "osm-walkways.json");
const outFile = join(root, "data", "walkways.json");

// Main campus, the hospital, the residence halls and the LIRR station, with room to spare (S, W, N, E).
const BBOX = "40.884,-73.146,40.930,-73.096";
// Ways a person can walk on. Motorways and trunk roads are left out; indoor corridors too, since
// buildings lock at night.
const WALKABLE =
  "^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|road|track|cycleway|bridleway|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link)$";
const QUERY = `[out:json][timeout:90];
(
  way["highway"~"${WALKABLE}"]["foot"~"^(yes|designated|permissive)$"](${BBOX});
  way["highway"~"${WALKABLE}"]["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"]["indoor"!="yes"](${BBOX});
);
out body;
>;
out skel qt;`;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
  "User-Agent": "Lupus/0.1 (SBUHacks 2026 campus transit app; github.com/tanmaykatke21/Lupus)",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download() {
  for (const url of ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: HEADERS,
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(120_000),
        });
        if ((res.status === 429 || res.status === 504) && attempt === 1) {
          console.warn(`  ${new URL(url).host} is busy (HTTP ${res.status}), retrying in 10 s...`);
          await sleep(10_000);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        console.log(`  got data from ${new URL(url).host}`);
        return body;
      } catch (err) {
        console.warn(`  ${new URL(url).host} failed: ${err.message}`);
        break;
      }
    }
  }
  return null;
}

let osm;
const inputAt = process.argv.indexOf("--input");
if (inputAt > 0) {
  osm = JSON.parse(readFileSync(process.argv[inputAt + 1], "utf8"));
  console.log(`using ${process.argv[inputAt + 1]} (${osm.elements.length} features)`);
} else if (existsSync(cacheFile) && !process.argv.includes("--refresh")) {
  osm = JSON.parse(readFileSync(cacheFile, "utf8"));
  console.log(`using cached OpenStreetMap data (${osm.elements.length} features)`);
} else {
  console.log("downloading campus walkways from OpenStreetMap (this can take a minute)...");
  osm = await download();
  if (!osm) {
    console.error("Could not reach any OpenStreetMap (Overpass) server. Wait a minute and run npm run build:walkways again.");
    process.exit(1);
  }
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(osm));
  console.log(`downloaded ${osm.elements.length} features`);
}

// Nodes by OpenStreetMap id, then an edge between every pair of consecutive nodes on a way.
const coords = new Map();
for (const e of osm.elements) if (e.type === "node") coords.set(e.id, [e.lon, e.lat]);

const index = new Map(); // osm node id -> our index
const nodes = [];
const edgeSet = new Set();
const edges = [];
let ways = 0;
const idx = (id) => {
  let i = index.get(id);
  if (i === undefined) {
    i = nodes.length;
    index.set(id, i);
    nodes.push(coords.get(id));
  }
  return i;
};
for (const e of osm.elements) {
  if (e.type !== "way" || !Array.isArray(e.nodes)) continue;
  const ids = e.nodes.filter((id) => coords.has(id));
  if (ids.length < 2) continue;
  ways++;
  for (let k = 1; k < ids.length; k++) {
    const a = idx(ids[k - 1]);
    const b = idx(ids[k]);
    if (a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([a, b]);
  }
}
if (!edges.length) {
  console.error("No walkways found in the OpenStreetMap data.");
  process.exit(1);
}

// Keep only the largest connected network, so a route never starts on an isolated scrap of path.
const parent = nodes.map((_, i) => i);
const find = (i) => {
  while (parent[i] !== i) i = parent[i] = parent[parent[i]];
  return i;
};
for (const [a, b] of edges) parent[find(a)] = find(b);
const size = new Map();
for (let i = 0; i < nodes.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
const main = [...size.entries()].sort((x, y) => y[1] - x[1])[0][0];
const remap = new Map();
const keptNodes = [];
nodes.forEach((n, i) => {
  if (find(i) === main) {
    remap.set(i, keptNodes.length);
    keptNodes.push(n);
  }
});
const keptEdges = edges.filter(([a]) => remap.has(a)).map(([a, b]) => [remap.get(a), remap.get(b)]);

// Total length, for the summary.
const rad = Math.PI / 180;
let km = 0;
for (const [a, b] of keptEdges) {
  const [lngA, latA] = keptNodes[a];
  const [lngB, latB] = keptNodes[b];
  km += Math.hypot((lngB - lngA) * 111.32 * Math.cos(latA * rad), (latB - latA) * 110.54);
}

const out = {
  version: 1,
  attribution: "© OpenStreetMap contributors (ODbL)",
  builtAt: new Date().toISOString(),
  bbox: BBOX,
  // [lng, lat] of every point in millionths of a degree (about 10 cm), flattened.
  nodes: keptNodes.flatMap(([lng, lat]) => [Math.round(lng * 1e6), Math.round(lat * 1e6)]),
  // Pairs of node indexes that are joined by a walkable path, flattened.
  edges: keptEdges.flat(),
};
const json = JSON.stringify(out);
writeFileSync(outFile, json + "\n");
console.log(
  `wrote data/walkways.json: ${ways} walkways, ${keptNodes.length} points, ${keptEdges.length} links, ` +
    `${km.toFixed(1)} km of paths (${Math.round(json.length / 1024)} KB)`,
);
if (keptNodes.length < nodes.length) {
  console.log(`left out ${nodes.length - keptNodes.length} points on paths not connected to the main network`);
}
