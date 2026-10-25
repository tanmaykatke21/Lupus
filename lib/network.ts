// Server-side ETA Spot access shared across requests via Next's `use cache`.
import { cacheLife } from "next/cache";
import shapesFile from "@/data/route-shapes.json";
import type { BusRoute, LngLat } from "./types";
import { getRoutes, getStopEtas, getStops, getVehicles } from "./etaspot";
import { fetchRealtime } from "./lirrRealtime";

const LIVE = { stale: 10, revalidate: 10, expire: 60 };

// Route lines from laps the buses actually drove (Tiger Data GPS, snapped to OSM roads) replace
// ETA Spot's coarse outlines wherever we have one (npm run build:shapes).
const SHAPES = shapesFile.routes as unknown as Record<string, { coords: LngLat[] }>;
export const withRecordedShapes = (routes: BusRoute[]) =>
  routes.map(r => (SHAPES[r.id]?.coords.length ? { ...r, shape: SHAPES[r.id].coords } : r));

export async function cachedRoutes() {
  "use cache";
  cacheLife("hours");
  return withRecordedShapes(await getRoutes());
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
