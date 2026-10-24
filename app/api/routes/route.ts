import { connection } from "next/server";
import { getRoutes } from "@/lib/etaspot";
import { CACHE, errorJson, json } from "@/lib/http";

export async function GET() {
  await connection();
  try {
    return json({ routes: await getRoutes() }, CACHE.static);
  } catch (err) {
    return errorJson(err);
  }
}
