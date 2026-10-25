import { describe, expect, it } from "vitest";
import live from "@/data/samples/etaspot-vehicles-live-1430.json";
import { normalizeVehicles, type RawVehicle } from "./etaspot";

describe("normalizeVehicles", () => {
  it("keeps each live bus's upcoming stop predictions (real 2:30 PM sample)", () => {
    const buses = normalizeVehicles(live.get_vehicles as unknown as RawVehicle[]).filter(b => b.inService);
    expect(buses.length).toBeGreaterThan(0);
    const outer = buses.find(b => b.routeId === 3)!;
    expect(outer.upcoming!.length).toBeGreaterThan(0);
    expect(outer.upcoming![0]).toEqual({ stopId: 9, minutes: 0 });
  });
});
