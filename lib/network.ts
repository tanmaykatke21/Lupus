// Server-side ETA Spot access shared across requests via Next's `use cache`.
import { cacheLife } from "next/cache";
import roadGraphFile from "@/data/road-graph.json";
import { RoadGraph, type RoadGraphFile } from "./roadMatch";
import type { BusRoute } from "./types";
import { getRoutes, getStopEtas, getStops, getVehicles } from "./etaspot";
import { fetchRealtime } from "./lirrRealtime";

const LIVE = { stale: 10, revalidate: 10, expire: 60 };

// ETA Spot's route lines are coarse (chords across loops and corners); snap them onto OSM roads so
// they follow the street. Works for whatever routes ETA Spot returns that day.
let roads: RoadGraph | null = null;
export function snapToRoads(routes: BusRoute[]) {
  roads ??= new RoadGraph(roadGraphFile as unknown as RoadGraphFile);
  return routes.map(r => ({ ...r, shape: roads!.match(r.shape) }));
}

export async function cachedRoutes() {
  "use cache";
  cacheLife("hours");
  return snapToRoads(await getRoutes());
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
