// Records ETA Spot data into Tiger Data. Runs on a laptop/VM, not on Vercel.
//
//   npm run poller              # write to DATABASE_URL
//   npm run poller -- --dry-run # fetch and print, no database
//   npm run poller -- --init    # apply scripts/sql/schema.sql first
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { ArrivalDetector, type Arrival } from "../lib/arrivals";
import { getStopEtas, getStops, getVehicles } from "../lib/etaspot";
import type { Bus, BusStop, StopEta } from "../lib/types";

config({ path: [".env.local", ".env"], quiet: true });

const VEHICLE_EVERY_MS = 10_000;
const STOP_ETAS_EVERY_MS = 60_000;
const STOP_REFRESH_MS = 60 * 60_000;
const ETA_CONCURRENCY = 4;

const dryRun = process.argv.includes("--dry-run");
const init = process.argv.includes("--init");
const once = process.argv.includes("--once");

if (!dryRun && !process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put it in .env.local or run with --dry-run.");
  process.exit(1);
}
const sql = dryRun ? null : postgres(process.env.DATABASE_URL!, { max: 3, onnotice: () => {} });

const log = (...args: unknown[]) => console.log(new Date().toLocaleTimeString("en-US", { hour12: false }), ...args);

let stops: BusStop[] = [];
let detector: ArrivalDetector;
const stats = { snapshots: 0, predictions: 0, arrivals: 0, errors: 0 };

async function writeSnapshots(buses: Bus[]) {
  if (!buses.length) return;
  const rows = buses.map(b => ({
    time: new Date(b.receivedAt),
    vehicle_id: b.id,
    route_id: b.routeId,
    lat: b.lat,
    lng: b.lng,
    heading: b.heading,
    next_stop_id: b.nextStopId,
    in_service: b.inService,
    load: b.load,
  }));
  if (sql) await sql`INSERT INTO vehicle_snapshots ${sql(rows)} ON CONFLICT DO NOTHING`;
  stats.snapshots += rows.length;
}

async function writePredictions(etas: StopEta[], source: "stop_etas" | "vehicle", at: Date) {
  if (!etas.length) return;
  const rows = etas.map(e => ({
    time: at,
    stop_id: e.stopId,
    route_id: e.routeId,
    trip_key: e.tripKey,
    vehicle_id: e.busId,
    predicted_arrival: new Date(e.arrivesAt),
    minutes: e.minutes,
    source,
  }));
  if (sql) await sql`INSERT INTO eta_predictions ${sql(rows)}`;
  stats.predictions += rows.length;
}

async function writeArrivals(arrivals: Arrival[]) {
  if (!arrivals.length) return;
  const rows = arrivals.map(a => ({
    time: new Date(a.time),
    vehicle_id: a.vehicleId,
    route_id: a.routeId,
    stop_id: a.stopId,
    distance_m: a.distanceM,
  }));
  if (sql) await sql`INSERT INTO stop_arrivals ${sql(rows)} ON CONFLICT DO NOTHING`;
  stats.arrivals += rows.length;
  for (const a of arrivals) log(`arrival  bus ${a.vehicleId} at stop ${a.stopId} (${a.distanceM.toFixed(0)} m)`);
}

async function pollVehicles() {
  const { raw, buses } = await getVehicles();
  await writeSnapshots(buses);
  await writeArrivals(buses.flatMap(b => detector.observe(b)));

  // Per-vehicle ETAs, when ETA Spot includes them. Shape unverified while no buses run,
  // so only rows with the fields we need are kept.
  const now = Date.now();
  const vehicleEtas: StopEta[] = raw.flatMap(v =>
    (v.minutesToNextStops ?? [])
      .filter(e => typeof e.stopID === "number" && typeof e.minutes === "number")
      .map(e => ({
        stopId: e.stopID!,
        routeId: v.routeID,
        tripKey: e.scheduleNumber ?? v.scheduleNumber,
        busId: v.equipmentID,
        minutes: e.minutes!,
        arrivesAt: now + e.minutes! * 60_000,
        scheduled: e.schedule ?? "",
        direction: e.direction ?? "",
      })));
  await writePredictions(vehicleEtas, "vehicle", new Date(now));
  return buses.length;
}

async function pollStopEtas() {
  const at = new Date();
  const queue = stops.map(s => s.id);
  const all: StopEta[] = [];
  await Promise.all(Array.from({ length: ETA_CONCURRENCY }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        all.push(...await getStopEtas(id));
      } catch (err) {
        stats.errors++;
        log(`stop ${id} ETAs failed: ${(err as Error).message}`);
      }
    }
  }));
  await writePredictions(all, "stop_etas", at);
  return all.length;
}

async function refreshStops() {
  stops = await getStops();
  if (detector) detector.setStops(stops);
  else detector = new ArrivalDetector(stops);
  log(`loaded ${stops.length} stops`);
}

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  const run = async () => {
    if (running) return; // never overlap a slow upstream call
    running = true;
    try {
      await fn();
    } catch (err) {
      stats.errors++;
      log(`${name} failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  run();
  return setInterval(run, ms);
}

async function main() {
  if (init) {
    if (!sql) throw new Error("--init needs DATABASE_URL");
    await sql.unsafe(readFileSync("scripts/sql/schema.sql", "utf8"));
    log("schema applied");
  }
  await refreshStops();
  log(dryRun ? "DRY RUN: nothing is written" : "writing to Tiger Data");

  if (once) {
    const n = await pollVehicles();
    const m = await pollStopEtas();
    log(`once: ${n} buses in service, ${m} stop predictions`, stats);
    await sql?.end();
    return;
  }

  every(VEHICLE_EVERY_MS, "vehicles", async () => {
    const n = await pollVehicles();
    if (n === 0) log("no buses in service");
  });
  every(STOP_ETAS_EVERY_MS, "stop ETAs", pollStopEtas);
  every(STOP_REFRESH_MS, "stops", refreshStops);
  setInterval(() => log("totals", stats), 60_000);

  const shutdown = async () => {
    log("stopping", stats);
    await sql?.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
