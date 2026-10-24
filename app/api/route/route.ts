import { connection } from "next/server";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";
import { planTrip } from "@/lib/planner";
import type { LngLat } from "@/lib/types";
import { OutsideMapError } from "@/lib/walk";

function parsePoint(v: string | null): LngLat | null {
  if (!v) return null;
  const [lat, lng] = v.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

function parseTime(v: string | null) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// GET /api/route?from=lat,lng&to=lat,lng&time=ISO&arriveBy=ISO&accessible=0|1&replay=0|1
export async function GET(request: Request) {
  await connection();
  const limited = rateLimit(request, 60);
  if (limited) return limited;

  const q = new URL(request.url).searchParams;
  const from = parsePoint(q.get("from"));
  const to = parsePoint(q.get("to"));
  const time = parseTime(q.get("time"));
  const arriveBy = parseTime(q.get("arriveBy"));
  if (!from || !to) return json({ error: "from and to must be lat,lng" }, CACHE.none, 400);
  if (time === null || arriveBy === null) return json({ error: "time and arriveBy must be ISO dates" }, CACHE.none, 400);

  try {
    const result = await planTrip(
      { from, to, time, arriveBy, accessible: q.get("accessible") === "1" },
      { replay: q.get("replay") === "1" },
    );
    return json({ ...result, generatedAt: Date.now() }, CACHE.none);
  } catch (err) {
    if (err instanceof OutsideMapError) {
      return json({ error: "That spot is outside the campus map." }, CACHE.none, 422);
    }
    return errorJson(err);
  }
}
