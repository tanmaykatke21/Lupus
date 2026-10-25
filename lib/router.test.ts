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
import type { BusRoute, LngLat, StopEta } from "./types";

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
    const all = await plan({ from: SAC, to: LIRR_STATION, time: at(0) }, deps());
    const options = all.filter(o => !o.slowerThanWalk);
    expect(options.map(o => o.kind)).toEqual(["walk"]); // first bus is 2+ hours away
    // …but the "Bus" filter still gets the fastest bus, flagged and ranked after walking.
    expect(all.at(-1)).toMatchObject({ kind: "bus", slowerThanWalk: true });
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
    expect(options.map(o => o.kind)).toEqual(["walk"]); // no bus data at all: nothing to flag either
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

describe("off-campus shuttles", () => {
  // Shaped like the Sunday shopping shuttle: SAC → Target → Walmart → Stop & Shop → SAC.
  // Only stops (from ETA Spot) are real; the route/ETAs are synthetic since it doesn't run on the sample day.
  const shopping: BusRoute = {
    id: 12, name: "Shopping Shuttle", abbr: "Shop", color: "#0a7", stopIds: [1, 42, 43, 44],
    shape: [pt(1), pt(42), pt(43), pt(44), pt(1)],
  };
  const etas = (id: number, min: number, trip = "t1", busId: string | null = "51"): StopEta =>
    ({ stopId: id, routeId: 12, tripKey: trip, busId, minutes: min, arrivesAt: T0 + min * 60_000, scheduled: "", direction: "" });
  const shopDeps = (byStop: Record<number, StopEta[]>, live = 1) =>
    deps({ routes: [shopping], timing: {}, etas: async id => byStop[id] ?? [], liveBusCount: () => live });
  const WALMART = pt(43);

  it("routes from campus to Walmart, walking the last bit off the campus map", async () => {
    const options = await plan({ from: SAC, to: WALMART, time: at(0) }, shopDeps({ 1: [etas(1, 5)], 43: [etas(43, 30)] }));
    const bus = options.find(o => o.kind === "bus")!;
    const ride = bus.legs.find((l): l is BusLeg => l.type === "bus")!;
    expect(ride).toMatchObject({ boardStopId: 1, alightStopId: 43, rideSource: "eta" });
    expect(options.some(o => o.kind === "walk")).toBe(false); // ~6 km: no walk-only option
  });

  it("plans the trip back from Walmart (origin off the walking map)", async () => {
    const options = await plan({ from: WALMART, to: SAC, time: at(0) }, shopDeps({ 43: [etas(43, 10, "t2")], 1: [etas(1, 40, "t2")] }));
    const ride = options.flatMap(o => o.legs).find((l): l is BusLeg => l.type === "bus")!;
    expect(ride).toMatchObject({ boardStopId: 43, alightStopId: 1, rideSource: "eta" });
  });

  it("estimates ride time from the route shape when there's no timetable or paired ETA", async () => {
    const options = await plan({ from: SAC, to: WALMART, time: at(0) }, shopDeps({ 1: [etas(1, 5)] }));
    const ride = options.flatMap(o => o.legs).find((l): l is BusLeg => l.type === "bus")!;
    expect(ride.rideSource).toBe("estimate");
    expect((ride.arriveAt - ride.departAt) / 60_000).toBeGreaterThan(5);
  });

  it("never invents trips for a route with no buses running", async () => {
    const options = await plan({ from: SAC, to: WALMART, time: at(10) }, // the only listed trip has left
      deps({ routes: [shopping], timing: { 12: { offsets: { 1: 0, 43: 20 }, cycleMinutes: 60 } },
        etas: async id => (id === 1 ? [etas(1, 5, "t1", null)] : []), liveBusCount: () => 0 }));
    expect(options).toEqual([]);
  });
});

describe("packed buses", () => {
  // The 07:00 Outer Loop at SAC (T0+143) is the bus to beat; give it a live bus id so load applies.
  const withBus = (busId: string) => async (id: number) =>
    (sampleEtas[id] ?? []).map(e => (e.routeId === 3 ? { ...e, busId } : e));

  it("skips a bus at 110% of its seats (no standing room left)", async () => {
    const options = await plan({ from: SAC, to: LIRR_STATION, time: at(140) },
      deps({ etas: withBus("61"), busLoad: () => 1.12, liveBusCount: () => 1 }));
    const used = options.flatMap(o => o.legs).filter((l): l is BusLeg => l.type === "bus");
    expect(used.every(l => !(l.routeId === 3 && l.departAt === T0 + 143 * 60_000))).toBe(true);
  });

  it("still boards a bus whose seats are taken but has standing room (105%)", async () => {
    const options = await plan({ from: SAC, to: LIRR_STATION, time: at(140) },
      deps({ etas: withBus("61"), busLoad: () => 1.05 }));
    const ride = options.flatMap(o => o.legs).find((l): l is BusLeg => l.type === "bus")!;
    expect(ride).toMatchObject({ routeId: 3, busId: "61", load: 1.05 });
  });

  it("demo mode treats the next bus as full and takes the following one, flagged", async () => {
    const options = await plan({ from: SAC, to: LIRR_STATION, time: at(140) },
      deps({ etas: withBus("61"), demoFullFirst: true, liveBusCount: () => 1 }));
    const bus = options.find(o => o.kind === "bus" && o.skippedFull);
    // The next Outer Loop is a cycle later, so walking may win; either way the full bus is never used.
    const used = options.flatMap(o => o.legs).filter((l): l is BusLeg => l.type === "bus");
    expect(used.some(l => l.departAt === T0 + 143 * 60_000)).toBe(false);
    if (bus) expect(bus.skippedFull).toMatchObject({ routeName: "Outer Loop", busId: "61", demo: true });
    // Whatever wins explains that the bus was full.
    expect(options[0].skippedFull).toMatchObject({ routeName: "Outer Loop", demo: true });
  });
});

