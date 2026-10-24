import { connection } from "next/server";
import { getStops } from "@/lib/etaspot";
import { CACHE, errorJson, json } from "@/lib/http";

export async function GET() {
  await connection();
  try {
    return json({ stops: await getStops() }, CACHE.static);
  } catch (err) {
    return errorJson(err);
  }
}
