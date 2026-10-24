import { connection } from "next/server";
import { getStopEtas } from "@/lib/etaspot";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";

// GET /api/etas?stop=19
export async function GET(request: Request) {
  await connection();
  const limited = rateLimit(request, 120);
  if (limited) return limited;
  const stop = Number(new URL(request.url).searchParams.get("stop"));
  if (!Number.isInteger(stop) || stop <= 0) return json({ error: "stop must be a stop id" }, "no-store", 400);
  try {
    return json({ etas: await getStopEtas(stop) }, CACHE.live);
  } catch (err) {
    return errorJson(err);
  }
}
