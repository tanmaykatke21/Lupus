import { readFile } from "node:fs/promises";
import path from "node:path";
import { clockLabel, minutesUntil } from "./campusTime";

export const ETASPOT_BASE = "https://stonybrook.etaspot.net/service.php";
// ETA Spot's public web tracker uses this token.
const TOKEN = "TESTING";

/** One vehicle exactly as ETA Spot sends it (only the fields we use are typed strictly). */
export interface RawVehicle {
  routeID: number;
  patternID: number;
  equipmentID: string;
  tripID: string | null;
  lat: number;
  lng: number;
  h: number;
  load: number;
  capacity: number;
  nextStopID: number;
  nextStopETA: number;
  lastStopID: number;
  inService: number;
  onSchedule: number | null;
  scheduleNumber: string;
  receiveTime: number;
  deadHead: number;
  wcSlots?: number | null;
  bkSlots?: number | null;
  // These only appear once a trip is under way.
  seq?: number;
  nextStopPctProg?: number;
  atStop?: number;
}

export type Crowding = "seats" | "busy" | "full" | "unknown";

export interface Bus {
  id: string;
  routeId: number;
  lat: number;
  lng: number;
  heading: number;
  load: number;
  capacity: number;
  crowding: Crowding;
  nextStopId: number | null;
  /** Minutes until the next stop, from the campus clock. Null when ETA Spot has no estimate. */
  minutesToNextStop: number | null;
  /** Clock time of the next stop, e.g. "12:42 PM". */
  nextStopAt: string | null;
  atStop: boolean;
  wheelchairSpaces: number | null;
  /** Seconds since the bus's last GPS fix. */
  ageSeconds: number;
}

export interface BusFeed {
  source: "live" | "sample";
  /** Instant the countdowns were computed against (ms). */
  asOf: number;
  buses: Bus[];
  /** Present when we fell back to sample data, so the UI can say why. */
  notice?: string;
}

/** A bus whose last GPS fix is older than this is treated as gone (parked, tracker off). */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export function crowdingFor(load: number, capacity: number): Crowding {
  if (!capacity || capacity <= 0) return "unknown";
  const ratio = load / capacity;
  if (ratio >= 0.85) return "full";
  if (ratio >= 0.5) return "busy";
  return "seats";
}

/**
 * Keep only buses that are actually carrying riders right now and convert them to the app's shape.
 * ETA Spot also returns parked buses (scheduleNumber "NIS", routeID 777) and trackers that went quiet days ago.
 */
export function normalizeVehicles(raw: RawVehicle[], nowMs: number): Bus[] {
  return raw
    .filter((v) => v.inService === 1 && v.deadHead !== 1)
    .filter((v) => nowMs - v.receiveTime <= STALE_AFTER_MS)
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map((v) => {
      const hasEta = v.nextStopETA >= 0 && v.nextStopID > 0;
      return {
        id: v.equipmentID.trim(),
        routeId: v.routeID,
        lat: v.lat,
        lng: v.lng,
        heading: v.h,
        load: v.load,
        capacity: v.capacity,
        crowding: crowdingFor(v.load, v.capacity),
        nextStopId: v.nextStopID > 0 ? v.nextStopID : null,
        minutesToNextStop: hasEta ? minutesUntil(v.nextStopETA, nowMs) : null,
        nextStopAt: hasEta ? clockLabel(v.nextStopETA) : null,
        atStop: v.atStop === 1,
        wheelchairSpaces: v.wcSlots ?? null,
        ageSeconds: Math.max(0, Math.round((nowMs - v.receiveTime) / 1000)),
      } satisfies Bus;
    })
    .sort((a, b) => (a.minutesToNextStop ?? Infinity) - (b.minutesToNextStop ?? Infinity));
}

async function fetchLiveVehicles(): Promise<RawVehicle[]> {
  const url = `${ETASPOT_BASE}?service=get_vehicles&includeETAData=1&token=${TOKEN}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`ETA Spot responded ${res.status}`);
  const body = (await res.json()) as { get_vehicles?: RawVehicle[] };
  if (!Array.isArray(body.get_vehicles)) throw new Error("ETA Spot response had no get_vehicles list");
  return body.get_vehicles;
}

/**
 * Saved snapshot used when ETA Spot is unreachable (or ETASPOT_MODE=sample).
 * Countdowns are computed against the snapshot's own time so they stay realistic.
 */
async function loadSample(): Promise<{ raw: RawVehicle[]; asOf: number }> {
  const file = path.join(process.cwd(), "data", "samples", "vehicles-1235.json");
  const body = JSON.parse(await readFile(file, "utf8")) as { get_vehicles: RawVehicle[] };
  const asOf = Math.max(...body.get_vehicles.filter((v) => v.inService === 1).map((v) => v.receiveTime));
  return { raw: body.get_vehicles, asOf };
}

// One upstream call is shared by every visitor for CACHE_MS, so ETA Spot sees at most one request per window.
const CACHE_MS = 10_000;
let cached: { at: number; feed: BusFeed } | null = null;
let inFlight: Promise<BusFeed> | null = null;

export async function getBusFeed(nowMs = Date.now()): Promise<BusFeed> {
  if (process.env.ETASPOT_MODE === "sample") {
    const { raw, asOf } = await loadSample();
    return { source: "sample", asOf, buses: normalizeVehicles(raw, asOf), notice: "Showing saved sample data." };
  }
  if (cached && nowMs - cached.at < CACHE_MS) return cached.feed;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const raw = await fetchLiveVehicles();
      const at = Date.now();
      const feed: BusFeed = { source: "live", asOf: at, buses: normalizeVehicles(raw, at) };
      cached = { at, feed };
      return feed;
    } catch (err) {
      // Serve the last good live data for up to a minute before admitting we're offline.
      if (cached && Date.now() - cached.at < 60_000) return cached.feed;
      const { raw, asOf } = await loadSample();
      const reason = err instanceof Error ? err.message : "unknown error";
      console.warn(`[etaspot] live feed unavailable (${reason}); serving sample data`);
      return {
        source: "sample",
        asOf,
        buses: normalizeVehicles(raw, asOf),
        notice: "Live bus data is unavailable right now. Showing a saved sample.",
      } satisfies BusFeed;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
