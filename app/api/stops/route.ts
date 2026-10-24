import { connection } from "next/server";
import { cachedStops } from "@/lib/network";
import { CACHE, errorJson, json } from "@/lib/http";

export async function GET() {
  await connection();
  try {
    return json({ stops: await cachedStops() }, CACHE.static);
  } catch (err) {
    return errorJson(err);
  }
}
