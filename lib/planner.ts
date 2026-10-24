// Wires the pure router to live (or replayed) data on the server.
import timingFile from "@/data/route-timing.json";
import { latenessTable, replayBuses, replayStopEtas, segmentTable } from "./history";
import { cachedBuses, cachedRoutes, cachedStopEtas, cachedStops } from "./network";
import { plan, type PlanRequest, type RouterDeps } from "./router";
import { historicalRideMinutes, reliabilityNote } from "./segments";
import { campusClock } from "./time";
import { getWalkGraph } from "./walkGraph";

export async function planTrip(req: PlanRequest, opts: { replay?: boolean } = {}) {
  const warnings: string[] = [];
  const now = (req.time ?? new Date()).getTime();
  const replay = opts.replay ? await replayBuses(Date.now()) : null;
  if (opts.replay && !replay) warnings.push("Replay needs recorded data in Tiger Data; using live data.");

  const [routes, stops, buses, segments, lateness] = await Promise.all([
    cachedRoutes().catch(() => { warnings.push("Bus routes unavailable: showing walking only."); return []; }),
    cachedStops().catch(() => []),
    replay ? replay.buses
      : cachedBuses().catch(() => { warnings.push("Live bus positions unavailable: times are from the schedule."); return []; }),
    segmentTable(),
    latenessTable(),
  ]);

  let etaFailures = 0;
  const deps: RouterDeps = {
    graph: getWalkGraph(),
    routes,
    stops,
    timing: timingFile.routes,
    etas: replay
      ? id => replayStopEtas(id, Date.now())
      : id => cachedStopEtas(id).catch(err => { etaFailures++; throw err; }),
    liveBusCount: routeId => buses.filter(b => b.routeId === routeId && b.inService).length,
    historicalRide: (routeId, from, to, at) => {
      const route = routes.find(r => r.id === routeId);
      return route ? historicalRideMinutes(segments, route, from, to, campusClock(at).minutes / 60 | 0) : null;
    },
  };
  const options = await plan(req, deps);
  for (const o of options) {
    const bus = o.legs.find(l => l.type === "bus");
    if (bus?.type === "bus") o.reliability = reliabilityNote(lateness, bus.routeId, campusClock(new Date(bus.departAt)).minutes / 60 | 0);
  }
  if (etaFailures) warnings.push("Some bus arrival times couldn't be loaded.");
  if (!options.length) warnings.push("No bus is running there right now, and it's too far to walk.");
  return { options, warnings, liveBuses: buses.length, source: replay ? "replay" as const : "live" as const, now };
}
