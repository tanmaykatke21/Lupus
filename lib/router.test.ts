import { describe, expect, it } from "vitest";
import routesSample from "@/data/samples/etaspot-routes.json";
import stopsSample from "@/data/samples/etaspot-stops.json";
import eta1 from "@/data/samples/etaspot-stop-etas-1.json";
import eta9 from "@/data/samples/etaspot-stop-etas-9.json";
import eta17 from "@/data/samples/etaspot-stop-etas-17.json";
import eta19 from "@/data/samples/etaspot-stop-etas-19.json";
import eta23 from "@/data/samples/etaspot-stop-etas-23.json";
import timingFile from "@/data/route-timing.json";
import { normalizeEtas, normalizeRoutes, normalizeStops, type RawEtaEntry, type RawRoute, type RawStop } from "./etaspot";
import { plan, shapeBetween, type BusLeg, type RouterDeps } from "./router";
import { getWalkGraph } from "./walkGraph";
import type { LngLat, StopEta } from "./types";

// Samples were captured at ~04:40 ET; their `minutes` count from that moment (T0).
const T0 = new Date("2026-10-24T08:40:00Z").getTime();
const at = (min: number) => new Date(T0 + min * 60_000);

const routes = normalizeRoutes(routesSample.get_routes as RawRoute[]);
const stops = normalizeStops(stopsSample.get_stops as RawStop[]);
const sampleEtas: Record<number, StopEta[]> = Object.fromEntries(
  ([[1, eta1], [9, eta9], [17, eta17], [19, eta19], [23, eta23]] as const).map(([id, f]) =>
    [id, normalizeEtas(id, f.get_stop_etas[0].enRoute as RawEtaEntry[], T0)]),
);
const stop = (id: number) => stops.find(s => s.id === id)!;
const pt = (id: number): LngLat => [stop(id).lng, stop(id).lat];

const deps = (over: Partial<RouterDeps> = {}): RouterDeps => ({
  graph: getWalkGraph(),
  routes,
  stops,
  timing: timingFile.routes,
  etas: async id => sampleEtas[id] ?? [],
  liveBusCount: () => 0,
  ...over,
});

const SAC = pt(1);
const LIRR_STATION: LngLat = [-73.12855, 40.92032];
const CHAPIN = pt(32);

describe("plan", () => {
  it("always includes a walk-only option", async () => {
    const options = await plan({ from: SAC, to: LIRR_STATION, time: at(0) }, deps());
    expect(options.map(o => o.kind)).toEqual(["walk"]); // first bus is 2+ hours away
    expect(options[0].slackMinutes).toBeNull();
  });

  it("takes the Outer Loop from SAC to the railroad when the bus is about to leave", async () => {
    // The 07:00 Outer Loop leaves SAC at T0+143 and reaches the LIRR stop at T0+148.
    const options = await plan({ from: SAC, to: LIRR_STATION, time: at(140) }, deps());
    const bus = options.find(o => o.kind === "bus")!;
    expect(bus).toBeDefined();
    expect(options[0]).toBe(bus); // fastest first
    const ride = bus.legs.find((l): l is BusLeg => l.type === "bus")!;
    expect(ride).toMatchObject({ routeName: "Outer Loop", boardStopId: 1, alightStopId: 19, rideSource: "eta" });
    expect(ride.arriveAt - ride.departAt).toBe(5 * 60_000);
    expect(bus.slackMinutes).toBeGreaterThan(0);
    expect(bus.slackMinutes).toBeLessThan(3);
    expect(options.length).toBeLessThanOrEqual(3);
  });

  it("skips a bus the user can't reach in time", async () => {
    const options = await plan({ from: SAC, to: LIRR_STATION, time: at(143) }, deps());
    expect(options.every(o => o.kind === "walk" || o.legs.some(l => l.type === "bus" && l.departAt >= at(143).getTime()))).toBe(true);
  });

  it("arrive-by returns the latest departure that still makes it, using schedule ride times", async () => {
    // Hospital/Chapin leaves SAC at T0+143; SAC → Chapin is 13 scheduled minutes. Walking takes ~23.
    const arriveBy = at(162);
    const options = await plan({ from: SAC, to: CHAPIN, time: at(100), arriveBy }, deps());
    const bus = options.find(o => o.kind === "bus")!;
    const ride = bus.legs.find((l): l is BusLeg => l.type === "bus")!;
    expect(ride.routeName).toBe("Hospital/Chapin");
    expect(ride.rideSource).toBe("schedule");
    expect(bus.arriveAt).toBeLessThanOrEqual(arriveBy.getTime());
    expect(bus.leaveBy).toBeGreaterThan(options.find(o => o.kind === "walk")!.leaveBy);
    expect(options[0]).toBe(bus); // latest leave-by ranks first in arrive-by mode
  });

  it("stays on the bus to the stop nearest the destination instead of walking from an earlier one", async () => {
    // From Greeley Hall, board at Kelly (9) for the railroad. Getting off at Gym Road East (17) or at
    // the LIRR stop (19) has the same leave-by time; riding on to 19 arrives sooner with less walking.
    const greeley: LngLat = [-73.13102, 40.91175];
    for (const arriveBy of [undefined, at(152)]) { // at(152): too tight to walk, the bus still makes it
      const options = await plan({ from: greeley, to: LIRR_STATION, time: at(138), arriveBy }, deps());
      const ride = options.flatMap(o => o.legs).find((l): l is BusLeg => l.type === "bus")!;
      expect(ride.boardStopId).toBe(9);
      expect(ride.alightStopId).toBe(19);
    }
  });

  it("falls back to walking when ETA Spot is down", async () => {
    const options = await plan({ from: SAC, to: CHAPIN, time: at(140) }, deps({ etas: async () => { throw new Error("down"); } }));
    expect(options.map(o => o.kind)).toEqual(["walk"]);
  });

  it("prefers historical ride times over the schedule when it can't pair a trip", async () => {
    const options = await plan({ from: SAC, to: CHAPIN, time: at(140) }, deps({ historicalRide: () => 9 }));
    const ride = options.flatMap(o => o.legs).find((l): l is BusLeg => l.type === "bus")!;
    expect(ride.rideSource).toBe("history");
    expect(ride.arriveAt - ride.departAt).toBe(9 * 60_000);
  });
});

describe("shapeBetween", () => {
  it("follows the route from board to alight", () => {
    const outer = routes.find(r => r.name === "Outer Loop")!;
    const line = shapeBetween(outer, stop(1), stop(19));
    expect(line[0]).toEqual(pt(1));
    expect(line.at(-1)).toEqual(pt(19));
    expect(line.length).toBeGreaterThan(5);
  });
});
