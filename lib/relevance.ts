import { meters, PATH_DETOUR, type LatLng } from "./geo";
import type { Network } from "./network";
import { MAX_STOP_WALK_M } from "./planner";

/** Route ids with a stop within walking range of `point`. */
function routesNear(network: Network, point: LatLng): Set<number> {
  const ids = new Set<number>();
  for (const s of network.stops) {
    if (meters(point, s) * PATH_DETOUR <= MAX_STOP_WALK_M) s.routeIds.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * Routes worth showing for a trip: those that stop near the destination and, when the start is known,
 * near the start too. If no route serves both ends, fall back to the routes near the destination.
 */
export function relevantRouteIds(network: Network, destination: LatLng, origin: LatLng | null): number[] {
  const toDest = routesNear(network, destination);
  if (!origin) return [...toDest].sort((a, b) => a - b);
  const fromStart = routesNear(network, origin);
  const both = [...toDest].filter((id) => fromStart.has(id));
  return (both.length ? both : [...toDest]).sort((a, b) => a - b);
}
