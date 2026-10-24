// Server-side ETA Spot access shared across requests via Next's `use cache`.
import { cacheLife } from "next/cache";
import { getRoutes, getStopEtas, getStops, getVehicles } from "./etaspot";
import { fetchRealtime } from "./lirrRealtime";

const LIVE = { stale: 10, revalidate: 10, expire: 60 };

export async function cachedRoutes() {
  "use cache";
  cacheLife("hours");
  return getRoutes();
}

export async function cachedStops() {
  "use cache";
  cacheLife("hours");
  return getStops();
}

export async function cachedBuses() {
  "use cache";
  cacheLife(LIVE);
  return (await getVehicles()).buses;
}

export async function cachedStopEtas(stopId: number) {
  "use cache";
  cacheLife(LIVE);
  return getStopEtas(stopId);
}

export async function cachedLirrRealtime() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  return fetchRealtime();
}
