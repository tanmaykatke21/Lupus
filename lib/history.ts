// Cached reads from Tiger Data. Every function returns null/[] when DATABASE_URL is unset.
// (Check dbConfigured() outside `use cache` scopes: errors thrown inside them lose their class.)
import { cacheLife } from "next/cache";
import type { AccuracyRow } from "./accuracy";
import { db, dbConfigured } from "./db";
import * as Q from "./queries";
import type { LatenessTable, SegmentTable } from "./segments";
import type { Bus, StopEta } from "./types";

async function loadSegments(): Promise<SegmentTable> {
  "use cache";
  cacheLife("hours");
  const rows = await db().unsafe<{ route_id: number; from_stop: number; to_stop: number; hour: number; avg_seconds: number; n: number }[]>(Q.SEGMENT_AVERAGES);
  const out: SegmentTable = {};
  const all = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    out[`${r.route_id}|${r.from_stop}|${r.to_stop}|${r.hour}`] = { avg: r.avg_seconds, n: r.n };
    const k = `${r.route_id}|${r.from_stop}|${r.to_stop}|*`;
    const a = all.get(k) ?? { sum: 0, n: 0 };
    a.sum += r.avg_seconds * r.n; a.n += r.n;
    all.set(k, a);
  }
  for (const [k, a] of all) out[k] = { avg: a.sum / a.n, n: a.n };
  return out;
}

async function loadLateness(): Promise<LatenessTable> {
  "use cache";
  cacheLife("hours");
  const rows = await db().unsafe<{ route_id: number; hour: number; avg_error_sec: number; n: number }[]>(Q.LATENESS_BY_HOUR);
  return Object.fromEntries(rows.map(r => [`${r.route_id}|${r.hour}`, { avg: r.avg_error_sec, n: r.n }]));
}

async function loadAccuracyRows(): Promise<AccuracyRow[]> {
  "use cache";
  cacheLife("minutes");
  const rows = await db().unsafe<{ time: Date; route_id: number; stop_id: number; horizon_min: number; hour: number; error_sec: number }[]>(Q.ACCURACY_ROWS);
  return rows.map(r => ({ time: r.time.getTime(), routeId: r.route_id, stopId: r.stop_id, horizonMin: r.horizon_min, hour: r.hour, errorSec: r.error_sec }));
}

async function loadReplayRange(): Promise<{ start: number; end: number; vehicles: number } | null> {
  "use cache";
  cacheLife("minutes");
  const [r] = await db().unsafe<{ start: Date | null; end: Date | null; vehicles: number }[]>(Q.REPLAY_RANGE);
  return r?.start && r.end && r.end.getTime() - r.start.getTime() > 10 * 60_000
    ? { start: r.start.getTime(), end: r.end.getTime(), vehicles: r.vehicles } : null;
}

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  if (!dbConfigured()) return fallback;
  try { return await fn(); } catch (err) { console.error("[history]", (err as Error).message); return fallback; }
};

export const segmentTable = () => safe(loadSegments, {} as SegmentTable);
export const latenessTable = () => safe(loadLateness, {} as LatenessTable);
export const accuracyRows = () => safe(loadAccuracyRows, [] as AccuracyRow[]);
export const replayRange = () => safe(loadReplayRange, null);

// --- replay: plays the recorded window on a loop, mapped onto the current time ---

export function replayInstant(range: { start: number; end: number }, now: number) {
  return range.start + (now % (range.end - range.start));
}

export async function replayBuses(now: number): Promise<{ buses: Bus[]; instant: number } | null> {
  const range = await replayRange();
  if (!range) return null;
  const instant = replayInstant(range, now);
  type Row = { vehicle_id: string; route_id: number; lat: number; lng: number; heading: number | null; next_stop_id: number | null; load: number | null };
  const rows = await safe(async (): Promise<Row[]> => [...await db().unsafe<Row[]>(Q.REPLAY_POSITIONS, [new Date(instant)])], []);
  return {
    instant,
    buses: rows.map(r => ({
      id: r.vehicle_id, routeId: r.route_id, lat: r.lat, lng: r.lng, heading: r.heading ?? 0,
      nextStopId: r.next_stop_id, inService: true, load: r.load, receivedAt: now,
    })),
  };
}

/** Recorded ETAs at a stop as of the replay instant, shifted so they read as "from now". */
export async function replayStopEtas(stopId: number, now: number): Promise<StopEta[]> {
  const range = await replayRange();
  if (!range) return [];
  const instant = replayInstant(range, now);
  type Row = { route_id: number; trip_key: string; vehicle_id: string | null; predicted_arrival: Date };
  const rows = await safe(async (): Promise<Row[]> => [...await db().unsafe<Row[]>(Q.REPLAY_STOP_ETAS, [stopId, new Date(instant)])], []);
  return rows.map(r => {
    const arrivesAt = now + (r.predicted_arrival.getTime() - instant);
    return {
      stopId, routeId: r.route_id, tripKey: r.trip_key, busId: r.vehicle_id,
      minutes: Math.round((arrivesAt - now) / 60_000), arrivesAt, scheduled: "", direction: "",
    };
  });
}
