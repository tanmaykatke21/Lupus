import { connection } from "next/server";
import { getNetwork } from "@/lib/etaspot";

// GET /api/network → routes (with their map shapes) and stops currently published by ETA Spot.
export async function GET() {
  await connection();
  const network = await getNetwork();
  return Response.json(network, {
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
  });
}
