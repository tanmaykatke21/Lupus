import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeVehicles, type RawVehicle } from "./etaspot";
import { buildNetwork, stopById, type RawRoute, type RawStop } from "./network";
import { observedSegments, planTrip, rideAlong } from "./planner";

// Real ETA Spot data saved on Sat Oct 24 2026 around 2:30 PM EDT.
const json = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "data", "samples", name), "utf8"));
const network = buildNetwork(
  json("routes-1430.json").get_routes as RawRoute[],
  json("stops-1430.json").get_stops as RawStop[],
  "saved",
);
const T = 1792866654000; // 2:30:54 PM EDT
const buses = normalizeVehicles(json("vehicles-1430-eta.json").get_vehicles as RawVehicle[], T);
const stop = (id: number) => stopById(network, id)!;
// A spot ~30 m from a stop, so walking to it takes under a minute.
const near = (id: number) => ({ lat: stop(id).lat + 0.0002, lng: stop(id).lng });

describe("network", () => {
  it("merges ETA Spot's per-route stop entries", () => {
    expect(network.routes.map((r) => r.name)).toEqual(["Charter", "Hospital/Chapin", "Outer Loop", "Port Jefferson Shuttle"]);
    expect(stop(1).name).toBe("SAC");
    expect(stop(1).routeIds.sort()).toEqual([3, 4, 8]);
  });
});

describe("planTrip", () => {
  it("picks the Outer Loop from the LIRR stop to M&H Quad using ETA Spot's own times", () => {
    const plan = planTrip(near(19), near(24), network, buses);
    expect(plan.best).toBe("bus");
    const top = plan.options[0];
    expect(top.routeId).toBe(3);
    expect(top.board.stop.name).toBe("Long Island Rail Road");
    expect(top.alight.stop.name).toBe("M&H Quad");
    expect(top.estimated).toBe(false);
    expect(top.boardInMin).toBeCloseTo(4.1, 1); // 2:35 PM
    expect(top.rideMin).toBeCloseTo(7, 1); // 2:35 → 2:42 PM
    expect(top.status).toBe("relax");
  });

  it("estimates the part of a ride beyond the stops ETA Spot lists", () => {
    // Life Science West comes after M&H Quad on the Outer Loop, past the five listed stops.
    const plan = planTrip(near(19), near(26), network, buses);
    const outer = plan.options.find((o) => o.routeId === 3)!;
    expect(outer.alight.stop.id).toBe(26);
    expect(outer.estimated).toBe(true);
    expect(outer.rideMin).toBeGreaterThan(7);
  });

  it("recommends walking for short hops", () => {
    // SAC to the Administration stop is a few minutes on foot.
    const plan = planTrip(near(1), near(25), network, buses);
    expect(plan.best).toBe("walk");
    expect(plan.walkMin).toBeLessThan(12);
  });

  it("flags a starting point far from any stop", () => {
    const hoboken = { lat: 40.7448, lng: -74.0256 };
    const plan = planTrip(hoboken, near(24), network, buses);
    expect(plan.farFromStops).toBe(true);
    expect(plan.options).toHaveLength(0);
    expect(plan.nearestStopMeters).toBeGreaterThan(50_000);
  });

  it("never offers a bus you can't reach even running", () => {
    // Bus 61 is at Kelly now (0 min). From ~500 m away you can't catch it there.
    const k = stop(9);
    const farFromKelly = { lat: k.lat + 0.0045, lng: k.lng };
    const plan = planTrip(farFromKelly, near(24), network, buses);
    expect(plan.options.some((o) => o.busId === "61" && o.board.stop.id === 9)).toBe(false);
  });

  it("asks you to run only when running still makes the bus", () => {
    for (const o of planTrip(near(19), near(24), network, buses).options) {
      if (o.status === "run") expect(o.board.walkMin / 2).toBeLessThanOrEqual(o.boardInMin + 0.01);
    }
  });
});

describe("rideAlong", () => {
  it("uses observed hop times where buses have reported them", () => {
    const seg = observedSegments(buses);
    const outer = network.routes.find((r) => r.id === 3)!;
    const stops = new Map(network.stops.map((s) => [s.id, s]));
    const ride = rideAlong(outer, 19, 24, stops, seg)!;
    expect(ride.estimated).toBe(false);
    expect(ride.minutes).toBeCloseTo(7, 1);
  });
});
