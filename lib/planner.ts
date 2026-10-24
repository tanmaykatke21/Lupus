// Wires the pure router to live data on the server.
import timingFile from "@/data/route-timing.json";
import { cachedBuses, cachedRoutes, cachedStopEtas, cachedStops } from "./network";
import { plan, type PlanRequest, type RouterDeps } from "./router";
import { getWalkGraph } from "./walkGraph";

export async function planTrip(req: PlanRequest, extra: Partial<RouterDeps> = {}) {
  const warnings: string[] = [];
  const [routes, stops, buses] = await Promise.all([
    cachedRoutes().catch(() => { warnings.push("Bus routes unavailable: showing walking only."); return []; }),
    cachedStops().catch(() => []),
    cachedBuses().catch(() => { warnings.push("Live bus positions unavailable: times are from the schedule."); return []; }),
  ]);
  let etaFailures = 0;
  const options = await plan(req, {
    graph: getWalkGraph(),
    routes,
    stops,
    timing: timingFile.routes,
    etas: id => cachedStopEtas(id).catch(err => { etaFailures++; throw err; }),
    liveBusCount: routeId => buses.filter(b => b.routeId === routeId && b.inService).length,
    ...extra,
  });
  if (etaFailures) warnings.push("Some bus arrival times couldn't be loaded.");
  return { options, warnings, liveBuses: buses.length };
}
