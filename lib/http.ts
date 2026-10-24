// Response helpers: cache headers (our caching layer on Vercel) and a per-IP rate limit.
import { UpstreamError } from "./etaspot";

export const CACHE = {
  live: "public, s-maxage=10, stale-while-revalidate=20",
  realtime: "public, s-maxage=30, stale-while-revalidate=60",
  static: "public, s-maxage=86400, stale-while-revalidate=604800",
  none: "no-store",
} as const;

export function json(data: unknown, cache: string = CACHE.none, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": cache } });
}

export function errorJson(err: unknown) {
  const upstream = err instanceof UpstreamError;
  console.error("[api]", err);
  return json(
    { error: upstream ? (err as Error).message : "Internal error", upstream },
    CACHE.none,
    upstream ? 502 : 500,
  );
}

// Fixed-window limiter. Serverless instances don't share memory, so this is
// per-instance and best-effort, which is enough to stop a runaway client in a demo.
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(request: Request, limit = 60, windowMs = 60_000) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const w = windows.get(ip);
  if (!w || now - w.start > windowMs) {
    windows.set(ip, { start: now, count: 1 });
    return null;
  }
  if (++w.count > limit) {
    return json({ error: "Too many requests" }, CACHE.none, 429);
  }
  return null;
}
