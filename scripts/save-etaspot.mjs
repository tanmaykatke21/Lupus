// Save ETA Spot's route list, stop list and a vehicle snapshot into data/samples/.
// Run this on a machine that can reach stonybrook.etaspot.net:  npm run save:etaspot
// The route and stop files give the app real route names and stop names in the next step.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://stonybrook.etaspot.net/service.php";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "samples");
mkdirSync(outDir, { recursive: true });

const services = [
  ["get_routes", "etaspot-routes.json"],
  ["get_stops", "etaspot-stops.json"],
  ["get_vehicles&includeETAData=1", "etaspot-vehicles-latest.json"],
];

for (const [service, file] of services) {
  const url = `${BASE}?service=${service}&token=TESTING`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    writeFileSync(join(outDir, file), JSON.stringify(body, null, 2) + "\n");
    const key = Object.keys(body)[0];
    const count = Array.isArray(body[key]) ? body[key].length : "?";
    console.log(`saved ${file} (${count} ${key.replace("get_", "")})`);
  } catch (err) {
    console.error(`could not fetch ${service}: ${err.message}`);
    process.exitCode = 1;
  }
}
