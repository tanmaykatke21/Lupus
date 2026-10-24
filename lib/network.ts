// Server-side ETA Spot access shared across requests via Next's `use cache`.
import { cacheLife } from "next/cache";
import { getRoutes, getStopEtas, getStops, getVehicles } from "./etaspot";

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
