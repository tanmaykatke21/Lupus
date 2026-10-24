"use client";

import { useEffect, useState } from "react";
import type { Bus, BusRoute, BusStop, BusesResponse } from "./types";

const BUS_POLL_MS = 10_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${url} failed (${res.status})`);
  return body as T;
}

export function useNetwork() {
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [stops, setStops] = useState<BusStop[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<{ routes: BusRoute[] }>("/api/routes"),
      getJson<{ stops: BusStop[] }>("/api/stops"),
    ])
      .then(([r, s]) => { setRoutes(r.routes); setStops(s.stops); })
      .catch(err => setError(err.message));
  }, []);

  return { routes, stops, error };
}

export function useBuses(replay = false) {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [source, setSource] = useState<BusesResponse["source"]>("live");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const data = await getJson<BusesResponse>(replay ? "/api/buses?replay=1" : "/api/buses");
        if (stopped) return;
        setBuses(data.buses);
        setSource(data.source);
        setUpdatedAt(data.fetchedAt);
        setError(null);
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      }
    };
    tick();
    const id = setInterval(() => { if (document.visibilityState === "visible") tick(); }, BUS_POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [replay]);

  return { buses, source, updatedAt, error };
}
