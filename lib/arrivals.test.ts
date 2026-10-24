import { describe, expect, it } from "vitest";
import { ArrivalDetector } from "./arrivals";
import type { Bus, BusStop } from "./types";

const kelly: BusStop = { id: 9, name: "Kelly", shortName: "Kelly", lat: 40.913425, lng: -73.129196, routeIds: [3] };
const sac: BusStop = { id: 1, name: "SAC", shortName: "SAC", lat: 40.91435, lng: -73.12492, routeIds: [3, 4] };

const bus = (over: Partial<Bus>): Bus => ({
  id: "42", routeId: 3, lat: 0, lng: 0, heading: 0, nextStopId: null, inService: true, load: null, receivedAt: 0, ...over,
});

describe("ArrivalDetector", () => {
  it("records an arrival when a bus is within 30 m of a stop on its route", () => {
    const d = new ArrivalDetector([kelly, sac]);
    const out = d.observe(bus({ lat: kelly.lat + 0.0001, lng: kelly.lng, receivedAt: 1000 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ stopId: 9, vehicleId: "42", time: 1000 });
    expect(out[0].distanceM).toBeLessThan(30);
  });

  it("ignores stops more than 30 m away and stops on other routes", () => {
    const d = new ArrivalDetector([kelly]);
    expect(d.observe(bus({ lat: kelly.lat + 0.001, lng: kelly.lng }))).toEqual([]); // ~110 m
    expect(d.observe(bus({ routeId: 4, lat: kelly.lat, lng: kelly.lng }))).toEqual([]);
  });

  it("counts a bus idling at a stop once, then again after it comes back later", () => {
    const d = new ArrivalDetector([kelly]);
    const at = (t: number) => d.observe(bus({ lat: kelly.lat, lng: kelly.lng, receivedAt: t }));
    expect(at(0)).toHaveLength(1);
    expect(at(10_000)).toHaveLength(0);
    expect(at(20_000)).toHaveLength(0);
    expect(at(20_000 + 15 * 60_000)).toHaveLength(1); // next lap
  });

  it("skips buses that are out of service", () => {
    const d = new ArrivalDetector([kelly]);
    expect(d.observe(bus({ inService: false, lat: kelly.lat, lng: kelly.lng }))).toEqual([]);
  });
});
