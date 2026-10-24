import { connection } from "next/server";
import { cachedRoutes } from "@/lib/network";
import { CACHE, errorJson, json } from "@/lib/http";

export async function GET() {
  await connection();
  try {
    return json({ routes: await cachedRoutes() }, CACHE.static);
  } catch (err) {
    return errorJson(err);
  }
}
