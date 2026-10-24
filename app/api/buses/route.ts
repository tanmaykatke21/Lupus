import { connection } from "next/server";
import { cachedBuses } from "@/lib/network";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";
import type { BusesResponse } from "@/lib/types";

export async function GET(request: Request) {
  await connection();
  const limited = rateLimit(request, 120);
  if (limited) return limited;
  try {
    const buses = await cachedBuses();
    const body: BusesResponse = { buses, source: "live", fetchedAt: Date.now() };
    return json(body, CACHE.live);
  } catch (err) {
    return errorJson(err);
  }
}
