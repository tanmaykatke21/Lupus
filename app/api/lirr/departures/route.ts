import { connection } from "next/server";
import schedule from "@/data/lirr-stony-brook.json";
import { CACHE, json, rateLimit } from "@/lib/http";
import { upcomingTrains, type LirrSchedule, type RealtimeMap } from "@/lib/lirr";
import { cachedLirrRealtime } from "@/lib/network";

// GET /api/lirr/departures?kind=departures|arrivals&direction=west|east&limit=8
export async function GET(request: Request) {
  await connection();
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind") === "arrivals" ? "arrivals" : "departures";
  const dir = q.get("direction");
  const direction = dir === "west" || dir === "east" ? dir : undefined;
  const limit = Math.min(20, Math.max(1, Number(q.get("limit")) || 8));

  // Realtime is optional: on failure we still serve the schedule, clearly labeled.
  let rt: RealtimeMap | null = null;
  let realtimeError: string | null = null;
  try {
    rt = await cachedLirrRealtime();
  } catch (err) {
    realtimeError = (err as Error).message;
  }
  const sched = schedule as LirrSchedule;
  const trains = upcomingTrains(sched, rt, { now: Date.now(), kind, direction, limit });
  return json({
    station: sched.station,
    trains,
    realtime: rt !== null,
    realtimeError,
    scheduleValidTo: sched.validTo,
    generatedAt: Date.now(),
  }, CACHE.realtime);
}
