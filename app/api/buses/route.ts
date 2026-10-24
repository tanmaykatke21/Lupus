import { connection } from "next/server";
import { replayBuses } from "@/lib/history";
import { cachedBuses } from "@/lib/network";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";
import type { BusesResponse } from "@/lib/types";

export async function GET(request: Request) {
  await connection();
  const limited = rateLimit(request, 120);
  if (limited) return limited;
  try {
    // ?replay=1 plays recorded positions from Tiger Data as if live (demo safety net).
    if (new URL(request.url).searchParams.get("replay") === "1") {
      const replay = await replayBuses(Date.now());
      if (replay) {
        const body: BusesResponse = { buses: replay.buses, source: "replay", fetchedAt: Date.now() };
        return json(body, CACHE.live);
      }
    }
    const buses = await cachedBuses();
    const body: BusesResponse = { buses, source: "live", fetchedAt: Date.now() };
    return json(body, CACHE.live);
  } catch (err) {
    return errorJson(err);
  }
}
