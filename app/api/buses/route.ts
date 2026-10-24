import { connection } from "next/server";
import { getBusFeed } from "@/lib/etaspot";

// GET /api/buses → in-service buses with countdowns to their next stop.
export async function GET() {
  // Always run at request time; a bus feed baked in at build time would be wrong.
  await connection();
  const feed = await getBusFeed();
  return Response.json(feed, {
    headers: {
      // Let Vercel's CDN share one response for 10 s, then serve stale for 20 s while refreshing.
      "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
    },
  });
}
