// Fill in campus place coordinates from OpenStreetMap and write data/places.json.
// Run on a machine that can reach the Overpass API:  npm run build:places
// Add --refresh to download again instead of reusing data/cache/osm-campus.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheFile = join(root, "data", "cache", "osm-campus.json");
const catalogFile = join(root, "data", "place-catalog.json");
const outFile = join(root, "data", "places.json");

// Box around the main campus, the hospital and the LIRR station (south, west, north, east).
const BBOX = "40.886,-73.142,40.928,-73.100";
const QUERY = `[out:json][timeout:60];
(
  nwr["building"]["name"](${BBOX});
  nwr["amenity"]["name"](${BBOX});
  nwr["name"~"Quad|Apartment|Lot"](${BBOX});
  nwr["railway"="station"](${BBOX});
  nwr["public_transport"="station"](${BBOX});
);
out center tags;`;

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function download() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`  ${new URL(url).host} failed: ${err.message}`);
    }
  }
  throw new Error("every Overpass server failed");
}

let osm;
if (existsSync(cacheFile) && !process.argv.includes("--refresh")) {
  osm = JSON.parse(readFileSync(cacheFile, "utf8"));
  console.log(`using cached OpenStreetMap data (${osm.elements.length} features)`);
} else {
  console.log("downloading campus buildings from OpenStreetMap...");
  osm = await download();
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(osm));
  console.log(`downloaded ${osm.elements.length} features`);
}

const features = osm.elements
  .map((e) => ({
    name: e.tags?.name ?? "",
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
    isBuilding: Boolean(e.tags?.building),
    isStation: e.tags?.railway === "station" || e.tags?.public_transport === "station",
  }))
  .filter((f) => f.name && Number.isFinite(f.lat) && Number.isFinite(f.lng));

const catalog = JSON.parse(readFileSync(catalogFile, "utf8")).places;
const places = [];
const missing = [];

for (const entry of catalog) {
  let lat = entry.lat;
  let lng = entry.lng;
  let source = "manual";
  if (lat === undefined || lng === undefined) {
    const re = new RegExp(entry.osm, "i");
    const candidates = features.filter((f) => re.test(f.name) && (entry.osmKind !== "station" || f.isStation));
    // Prefer an actual building over a parking lot or amenity point with a similar name.
    const hit = candidates.find((f) => f.isBuilding) ?? candidates[0];
    if (!hit) {
      missing.push(entry);
      continue;
    }
    ({ lat, lng } = hit);
    source = `osm: ${hit.name}`;
  }
  places.push({
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases,
    category: entry.category,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    source,
  });
}

writeFileSync(outFile, JSON.stringify(places, null, 2) + "\n");
console.log(`wrote data/places.json: ${places.length} of ${catalog.length} places located`);
if (missing.length) {
  console.log(`not found in OpenStreetMap (${missing.length}): ${missing.map((m) => m.name).join(", ")}`);
}
