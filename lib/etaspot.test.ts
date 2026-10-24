import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { campusMinutes, clockLabel, minutesUntil } from "./campusTime";
import { crowdingFor, normalizeVehicles, type RawVehicle } from "./etaspot";

// Two real snapshots taken ~9 minutes apart on Sat Oct 24 2026 (12:25:52 and 12:35:12 EDT).
const load = (name: string) =>
  (JSON.parse(readFileSync(path.join(__dirname, "..", "data", "samples", name), "utf8")) as {
    get_vehicles: RawVehicle[];
  }).get_vehicles;
const first = load("vehicles-1225.json");
const second = load("vehicles-1235.json");
const T1 = 1792859152000; // 12:25:52 EDT
const T2 = 1792859712000; // 12:35:12 EDT

describe("campus clock", () => {
  it("reads New York time regardless of server time zone", () => {
    expect(campusMinutes(T1)).toBeCloseTo(12 * 60 + 25 + 52 / 60, 3);
  });

  it("converts minutes-since-midnight ETAs into countdowns", () => {
    expect(minutesUntil(751, T1)).toBeCloseTo(5.13, 1); // 12:31 PM
    expect(minutesUntil(-1, T1)).toBeNull();
  });

  it("handles a next stop just after midnight", () => {
    const at2358 = T1 + (23 * 60 + 58 - campusMinutes(T1)) * 60_000;
    expect(minutesUntil(3, at2358)).toBeCloseTo(5, 3);
  });

  it("formats clock labels", () => {
    expect(clockLabel(751)).toBe("12:31 PM");
    expect(clockLabel(3)).toBe("12:03 AM");
  });
});

describe("normalizeVehicles", () => {
  it("drops parked and stale buses, keeping the four in service", () => {
    const buses = normalizeVehicles(first, T1);
    expect(buses.map((b) => b.id).sort()).toEqual(["59", "63", "64", "SH6"]);
  });

  it("drops buses whose GPS fix is older than three minutes", () => {
    expect(normalizeVehicles(first, T1 + 10 * 60_000)).toHaveLength(0);
  });

  it("sorts by soonest next stop and fills countdowns", () => {
    const buses = normalizeVehicles(second, T2);
    expect(buses[0].id).toBe("64"); // next stop at 12:36
    expect(buses[0].minutesToNextStop).toBeCloseTo(0.8, 1);
    expect(buses[0].nextStopAt).toBe("12:36 PM");
    expect(buses.every((b) => b.minutesToNextStop !== null)).toBe(true);
  });

  it("tracks real movement between snapshots", () => {
    const before = normalizeVehicles(first, T1).find((b) => b.id === "59")!;
    const after = normalizeVehicles(second, T2).find((b) => b.id === "59")!;
    expect(after.nextStopId).toBe(24);
    expect(after.load).toBeGreaterThan(before.load);
  });
});

describe("crowdingFor", () => {
  it("buckets load against capacity", () => {
    expect(crowdingFor(4, 50)).toBe("seats");
    expect(crowdingFor(30, 50)).toBe("busy");
    expect(crowdingFor(13, 14)).toBe("full");
    expect(crowdingFor(0, 0)).toBe("unknown");
  });
});

describe("upcoming stops (includeETAData)", () => {
  const latest = load("vehicles-1430-eta.json");
  // Bus 61's GPS fix in this snapshot: Sat Oct 24 2026, 2:30:54 PM EDT.
  const T3 = 1792866654000;

  it("parses ETA Spot clock strings", async () => {
    const { parseClock } = await import("./etaspot");
    expect(parseClock("02:31PM")).toBe(14 * 60 + 31);
    expect(parseClock("12:05AM")).toBe(5);
    expect(parseClock("On Time")).toBeNull();
  });

  it("lists each bus's next stops with minutes from now", () => {
    const bus = normalizeVehicles(latest, T3).find((b) => b.id === "61")!;
    expect(bus.upcoming.map((u) => u.stopId)).toEqual([9, 17, 20, 19, 24]);
    expect(bus.upcoming[3].at).toBe("2:35 PM");
    expect(bus.upcoming[3].minutes).toBeCloseTo(4.1, 1);
  });

  it("keeps only the first visit when a loop lists a stop twice", () => {
    const charter = normalizeVehicles(latest, T3).find((b) => b.routeId === 25);
    if (charter) expect(charter.upcoming.filter((u) => u.stopId === 53)).toHaveLength(1);
  });
});
