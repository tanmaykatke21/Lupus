"use client";

import { useEffect, useState } from "react";
import type { RouteOption } from "./router";
import type { LngLat } from "./types";

export interface Endpoint {
  name: string;
  lng: number;
  lat: number;
  placeId?: string;
}

export interface TripRequest {
  to: Endpoint;
  arriveBy?: number; // ms
  context?: string; // e.g. "the 6:12 PM to Penn Station"
}

export interface TripResult {
  options: RouteOption[];
  warnings: string[];
  liveBuses: number;
  generatedAt: number;
}

const REFRESH_MS = 30_000;

export function useTrip(from: LngLat | null, req: TripRequest | null, accessible: boolean, replay = false) {
  const [data, setData] = useState<TripResult | null>(null);
  const [error, setError] = useState<{ message: string; offMap: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const key = from && req ? JSON.stringify([from.map(n => n.toFixed(4)), req.to.lng, req.to.lat, req.arriveBy, accessible, replay]) : null;

  useEffect(() => {
    if (!key || !from || !req) return;
    let stopped = false;
    const load = async () => {
      setLoading(true);
      const q = new URLSearchParams({
        from: `${from[1]},${from[0]}`,
        to: `${req.to.lat},${req.to.lng}`,
        accessible: accessible ? "1" : "0",
      });
      if (req.arriveBy) q.set("arriveBy", new Date(req.arriveBy).toISOString());
      if (replay) q.set("replay", "1");
      try {
        const res = await fetch(`/api/route?${q}`);
        const body = await res.json();
        if (stopped) return;
        if (!res.ok) { setError({ message: body.error ?? "Routing failed", offMap: res.status === 422 }); setData(null); }
        else { setData(body); setError(null); }
      } catch {
        if (!stopped) setError({ message: "You're offline or the server is unreachable.", offMap: false });
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { stopped = true; clearInterval(id); };
    // `key` captures every input that changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data: key ? data : null, error: key ? error : null, loading };
}
