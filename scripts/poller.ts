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
import { INSERT_PREDICTION_ERRORS } from "../lib/queries";
import type { Bus, BusStop, StopEta } from "../lib/types";

config({ path: [".env.local", ".env"], quiet: true });

const VEHICLE_EVERY_MS = 10_000;
const MAX_SEGMENT_MS = 45 * 60_000; // longer gaps mean the bus went off route or out of service
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
const stats = { snapshots: 0, predictions: 0, arrivals: 0, segments: 0, predictionErrors: 0, errors: 0 };
const lastArrival = new Map<string, Arrival>(); // per vehicle

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

  for (const a of arrivals) {
    log(`arrival  bus ${a.vehicleId} at stop ${a.stopId} (${a.distanceM.toFixed(0)} m)`);

    // Stop-to-stop travel time since this bus's previous stop.
    const prev = lastArrival.get(a.vehicleId);
    lastArrival.set(a.vehicleId, a);
    if (prev && prev.routeId === a.routeId && prev.stopId !== a.stopId && a.time - prev.time < MAX_SEGMENT_MS) {
      const seg = { time: new Date(a.time), vehicle_id: a.vehicleId, route_id: a.routeId, from_stop: prev.stopId, to_stop: a.stopId, seconds: (a.time - prev.time) / 1000 };
      if (sql) await sql`INSERT INTO segment_times ${sql(seg)} ON CONFLICT DO NOTHING`;
      stats.segments++;
    }

    // How wrong was ETA Spot 2-5, 5-10 and 10-20 minutes ago?
    if (sql) {
      const res = await sql.unsafe(INSERT_PREDICTION_ERRORS, [new Date(a.time), a.routeId, a.stopId, a.vehicleId]);
      stats.predictionErrors += res.count;
    }
  }
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
