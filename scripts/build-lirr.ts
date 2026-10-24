// Builds data/lirr-stony-brook.json from MTA's LIRR static GTFS: only trips that stop at
// Stony Brook, with their service dates and times at key stations.
// Run: `npm run build:lirr` (add --refresh to re-download the zip).
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { LirrSchedule, LirrTrip } from "../lib/lirr";

const URL_ = "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip";
const CACHE = "data/cache/gtfslirr.zip";
const OUT = "data/lirr-stony-brook.json";

const STONY_BROOK = "14";
// Times recorded at these stations when the trip serves them.
const KEY_STATIONS: Record<string, keyof LirrTrip["at"]> = {
  "237": "penn", "349": "grandCentral", "102": "jamaica", "164": "portJefferson", "14": "stonyBrook",
};

async function loadZip() {
  if (!existsSync(CACHE) || process.argv.includes("--refresh")) {
    console.log("downloading", URL_);
    const res = await fetch(URL_);
    if (!res.ok) throw new Error(`GTFS download failed: ${res.status}`);
    mkdirSync("data/cache", { recursive: true });
    writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  return new AdmZip(readFileSync(CACHE));
}

function table<T>(zip: AdmZip, name: string): T[] {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} missing from GTFS`);
  return parse(entry.getData().toString("utf8"), { columns: true, skip_empty_lines: true, bom: true }) as T[];
}

// GTFS times can exceed 24:00 for trips that run past midnight.
const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

async function main() {
  const zip = await loadZip();
  const stops = table<{ stop_id: string; stop_name: string; stop_lat: string; stop_lon: string }>(zip, "stops.txt");
  const routes = table<{ route_id: string; route_long_name: string; route_color: string }>(zip, "routes.txt");
  const trips = table<{ route_id: string; service_id: string; trip_id: string; trip_headsign: string; trip_short_name: string; direction_id: string }>(zip, "trips.txt");
  const stopTimes = table<{ trip_id: string; arrival_time: string; departure_time: string; stop_id: string; stop_sequence: string }>(zip, "stop_times.txt");
  const calendarDates = table<{ service_id: string; date: string; exception_type: string }>(zip, "calendar_dates.txt");
  const feedInfo = zip.getEntry("feed_info.txt") ? table<Record<string, string>>(zip, "feed_info.txt")[0] : {};

  const stopName = new Map(stops.map(s => [s.stop_id, s.stop_name]));
  const routeById = new Map(routes.map(r => [r.route_id, r]));

  // Group stop times by trip, keeping only trips that serve Stony Brook.
  const byTrip = new Map<string, typeof stopTimes>();
  for (const st of stopTimes) {
    const list = byTrip.get(st.trip_id);
    if (list) list.push(st); else byTrip.set(st.trip_id, [st]);
  }

  const out: LirrTrip[] = [];
  const usedServices = new Set<string>();
  for (const t of trips) {
    const sts = byTrip.get(t.trip_id);
    const sb = sts?.find(s => s.stop_id === STONY_BROOK);
    if (!sts || !sb) continue;
    sts.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const at: LirrTrip["at"] = {};
    for (const s of sts) {
      const key = KEY_STATIONS[s.stop_id];
      if (key) at[key] = { arr: toMinutes(s.arrival_time), dep: toMinutes(s.departure_time) };
    }
    const first = sts[0], last = sts[sts.length - 1];
    const route = routeById.get(t.route_id);
    out.push({
      tripId: t.trip_id,
      serviceId: t.service_id,
      train: t.trip_short_name,
      branch: route?.route_long_name ?? "",
      color: route?.route_color ? `#${route.route_color}` : "#006EC7",
      // LIRR: direction_id 1 = westbound (toward NYC), 0 = eastbound.
      direction: t.direction_id === "1" ? "west" : "east",
      headsign: t.trip_headsign,
      origin: stopName.get(first.stop_id) ?? first.stop_id,
      terminal: stopName.get(last.stop_id) ?? last.stop_id,
      startsHere: first.stop_id === STONY_BROOK,
      endsHere: last.stop_id === STONY_BROOK,
      at,
    });
    usedServices.add(t.service_id);
  }
  out.sort((a, b) => a.at.stonyBrook!.dep - b.at.stonyBrook!.dep);

  const services: LirrSchedule["services"] = {};
  for (const cd of calendarDates) {
    if (!usedServices.has(cd.service_id)) continue;
    const s = (services[cd.service_id] ??= { add: [], remove: [] });
    (cd.exception_type === "1" ? s.add : s.remove).push(cd.date);
  }
  const dates = Object.values(services).flatMap(s => s.add).sort();

  const sb = stops.find(s => s.stop_id === STONY_BROOK)!;
  const schedule: LirrSchedule = {
    builtAt: new Date().toISOString(),
    feedVersion: feedInfo.feed_version ?? null,
    validFrom: dates[0],
    validTo: dates[dates.length - 1],
    station: { id: STONY_BROOK, name: sb.stop_name, lat: Number(sb.stop_lat), lng: Number(sb.stop_lon) },
    services,
    trips: out,
  };
  writeFileSync(OUT, JSON.stringify(schedule));
  console.log(`${out.length} trips at Stony Brook (${out.filter(t => t.direction === "west").length} west, ` +
    `${out.filter(t => t.direction === "east").length} east), service ${schedule.validFrom}–${schedule.validTo} → ${OUT} ` +
    `(${Math.round(JSON.stringify(schedule).length / 1024)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
