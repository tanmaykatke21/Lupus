import { connection } from "next/server";
import { meters } from "@/lib/geo";
import { walkBetween } from "@/lib/walkService";

/** "40.9124,-73.1234" → {lat, lng}, or null when it isn't a coordinate. */
function parsePoint(value: string | null) {
  const parts = (value ?? "").split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lat, lng] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// GET /api/walk?from=lat,lng&to=lat,lng → walking directions along campus paths.
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const from = parsePoint(params.get("from"));
  const to = parsePoint(params.get("to"));
  if (!from || !to) {
    return Response.json({ error: "Give from and to as lat,lng." }, { status: 400 });
  }
  if (meters(from, to) > 25_000) {
    return Response.json({ error: "That's too far to walk." }, { status: 400 });
  }
  // Same points always give the same walk, so let the CDN keep answers for a day.
  return Response.json(walkBetween(from, to), {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
