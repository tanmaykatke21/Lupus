import { describe, expect, it } from "vitest";
import { bearing, guide, phaseDone, phasesFor, pointAlong, project, turn } from "./compass";
import type { RouteOption } from "./router";
import type { LngLat } from "./types";

// An L-shaped path: ~222 m north, then ~250 m east.
const L: LngLat[] = [[-73.13, 40.91], [-73.13, 40.912], [-73.127, 40.912]];

describe("bearing and turn", () => {
  it("measures clockwise from north", () => {
    expect(bearing([-73.13, 40.91], [-73.13, 40.92])).toBeCloseTo(0, 0);
    expect(bearing([-73.13, 40.91], [-73.12, 40.91])).toBeCloseTo(90, 0);
    expect(bearing([-73.13, 40.91], [-73.13, 40.90])).toBeCloseTo(180, 0);
  });
  it("takes the short way round", () => {
    expect(turn(350, 10)).toBe(20);
    expect(turn(10, 350)).toBe(-20);
  });
});

describe("following a path", () => {
  it("projects onto the path and finds points along it", () => {
    expect(project(L, [-73.1301, 40.911]).along).toBeCloseTo(111, -1);
    const corner = pointAlong(L, 222.4);
    expect(corner[1]).toBeCloseTo(40.912, 4);
  });

  it("points along the route, bending at corners, not straight at the end", () => {
    const start = guide(L, [-73.13, 40.9101]);
    expect(start.bearing).toBeCloseTo(0, -1); // first leg heads north even though the end is north-east
    const nearCorner = guide(L, [-73.13, 40.9119]);
    expect(nearCorner.bearing).toBeGreaterThan(45); // lookahead has turned the corner
    expect(nearCorner.remaining).toBeLessThan(300);
  });

  it("points back to the route when you've wandered off it", () => {
    const off = guide(L, [-73.1315, 40.911]); // ~125 m west of the first leg
    expect(off.offset).toBeGreaterThan(100);
    expect(off.bearing).toBeGreaterThan(45);
    expect(off.bearing).toBeLessThan(135); // east, back toward the path
  });
});

const T = 1_800_000_000_000;
const option = {
  id: "bus", kind: "bus", leaveBy: T, arriveAt: T + 15 * 60_000, slackMinutes: 2, totalMinutes: 15,
  breakdown: { walk: 6, wait: 2, ride: 7 }, estimated: false,
  legs: [
    { type: "walk", meters: 200, seconds: 150, coords: L, shortcuts: [], stairs: false, toLabel: "Kelly" },
    { type: "wait", stopId: 9, stopName: "Kelly", seconds: 120 },
    { type: "bus", routeId: 3, routeName: "Outer Loop", color: "#0a0", busId: "61", tripKey: "t", boardStopId: 9,
      boardStopName: "Kelly", alightStopId: 19, alightStopName: "Long Island Rail Road", departAt: T + 5 * 60_000,
      arriveAt: T + 9 * 60_000, stopCount: 3, coords: [[-73.127, 40.912], [-73.127, 40.92]], live: true, rideSource: "eta" },
    { type: "walk", meters: 5, seconds: 4, coords: [[-73.127, 40.92], [-73.12701, 40.92]], shortcuts: [], stairs: false, toLabel: "your destination" },
  ],
} as unknown as RouteOption;

describe("phases", () => {
  const phases = phasesFor(option, "LIRR Station");

  it("walk → wait → ride → arrive (tiny final walks dropped)", () => {
    expect(phases.map(p => p.kind)).toEqual(["walk", "wait", "ride", "arrive"]);
    expect(phases[0]).toMatchObject({ toLabel: "Kelly stop" });
  });

  it("finishes the walk at the stop, the wait once the bus has left, the ride near the alight stop", () => {
    expect(phaseDone(phases[0], [-73.127, 40.912], T)).toBe(true);
    expect(phaseDone(phases[0], [-73.13, 40.91], T)).toBe(false);
    expect(phaseDone(phases[1], null, T + 4 * 60_000)).toBe(false);
    expect(phaseDone(phases[1], null, T + 6 * 60_000)).toBe(true);
    expect(phaseDone(phases[2], [-73.127, 40.9199], T + 7 * 60_000)).toBe(true);
    expect(phaseDone(phases[3], [-73.127, 40.92], T)).toBe(false); // arrival is terminal
  });
});
