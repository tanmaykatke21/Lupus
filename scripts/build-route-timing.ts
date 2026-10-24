// Builds data/route-timing.json: scheduled minutes from a route's first stop to each of its stops,
// taken from ETA Spot's own per-stop ETAs. Each stop lists the next trip per route keyed by
// scheduleNumber, so stops that report the same scheduleNumber give consistent offsets for one trip.
// Best run when service is idle (early morning), when every stop lists the day's first trip.
// ETA Spot only lists routes running that day, so results merge into the existing file: run it on
// a weekday, a Friday/Saturday and a Sunday to cover the shuttles that only run some days.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getRoutes, getStopEtas } from "../lib/etaspot";
import type { StopEta } from "../lib/types";

export interface RouteTiming {
  builtAt: string;
  routes: Record<string, { tripKey: string; offsets: Record<string, number>; cycleMinutes: number }>;
}

async function main() {
  const routes = await getRoutes();
  const stopIds = [...new Set(routes.flatMap(r => r.stopIds))];
  const etas: StopEta[] = [];
  for (const id of stopIds) {
    etas.push(...await getStopEtas(id)); // sequential: be gentle with SBU's server
  }

  const previous: RouteTiming | null = existsSync("data/route-timing.json")
    ? JSON.parse(readFileSync("data/route-timing.json", "utf8")) : null;
  const out: RouteTiming = { builtAt: new Date().toISOString(), routes: { ...previous?.routes } };
  for (const r of routes) {
    const mine = etas.filter(e => e.routeId === r.id);
    // The trip seen at the most stops is the one we can measure end to end.
    const counts = new Map<string, number>();
    for (const e of mine) counts.set(e.tripKey, (counts.get(e.tripKey) ?? 0) + 1);
    const [tripKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!tripKey) { console.log(`${r.name}: no ETAs, skipped`); continue; }

    const at = new Map(mine.filter(e => e.tripKey === tripKey).map(e => [e.stopId, e.arrivesAt]));
    const first = at.get(r.stopIds[0]) ?? Math.min(...at.values());
    const offsets: Record<string, number> = {};
    for (const id of r.stopIds) {
      const t = at.get(id);
      if (t !== undefined) offsets[id] = Math.round((t - first) / 60_000);
    }
    const values = Object.values(offsets);
    // Loops return to the first stop; assume ~2 min from the last listed stop back to it.
    const cycleMinutes = Math.max(...values) + 2;
    out.routes[r.id] = { tripKey, offsets, cycleMinutes };
    const missing = r.stopIds.filter(id => offsets[id] === undefined);
    console.log(`${r.name}: trip ${tripKey}, ${values.length}/${r.stopIds.length} stops, cycle ~${cycleMinutes} min` +
      (missing.length ? `, missing ${missing.join(",")}` : ""));
  }
  writeFileSync("data/route-timing.json", JSON.stringify(out, null, 1));
}

main().catch(err => { console.error(err); process.exit(1); });
