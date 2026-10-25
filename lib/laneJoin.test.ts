import { describe, expect, it } from "vitest";
import { bundleZones, chainLanes, joinLanes } from "./laneJoin";
import { laneRoutes } from "./lanes";

const WEST: [number, number] = [-73.13, 40.912];
const MID: [number, number] = [-73.125, 40.912];
const EAST: [number, number] = [-73.12, 40.912];
const NORTH: [number, number] = [-73.125, 40.92];

describe("joinLanes", () => {
  it("leaves a route without lane changes alone", () => {
    const pieces = [{ id: 1, lane: 0, coords: [WEST, EAST] as [number, number][] }];
    expect(joinLanes(pieces)).toEqual(pieces);
  });

  it("keeps each route one connected chain with small lane steps", () => {
    // Route 1 shares the west half with route 2, then carries on alone.
    const pieces = joinLanes(laneRoutes([
      { id: 1, coords: [WEST, MID, EAST] },
      { id: 2, coords: [WEST, MID, NORTH] },
    ]));
    for (const id of [1, 2]) {
      const mine = pieces.filter(p => p.id === id);
      expect(new Set(mine.map(p => p.lane)).size).toBeGreaterThan(2); // ramp pieces in between
      for (let i = 1; i < mine.length; i++) {
        expect(mine[i].coords[0]).toEqual(mine[i - 1].coords[mine[i - 1].coords.length - 1]);
        expect(Math.abs(mine[i].lane - mine[i - 1].lane)).toBeLessThanOrEqual(0.25 + 1e-9);
      }
    }
  });
});

describe("chainLanes", () => {
  it("makes each connected run of a route one line with a lane per point", () => {
    const chains = chainLanes(joinLanes(laneRoutes([
      { id: 1, coords: [WEST, MID, EAST] },
      { id: 2, coords: [WEST, MID, NORTH] },
    ])));
    for (const id of [1, 2]) {
      const mine = chains.filter(c => c.id === id);
      expect(mine).toHaveLength(1);
      expect(mine[0].lanes).toHaveLength(mine[0].coords.length);
    }
  });
});

describe("bundleZones", () => {
  it("draws every route in lane 0 inside a zone, and leaves it alone outside", () => {
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST] },
      { id: 2, coords: [WEST, EAST] },
    ]);
    // A 100 m zone around the east end of the shared road.
    const bundled = bundleZones(pieces, [{ lat: EAST[1], lng: EAST[0], radiusM: 100 }]);
    for (const id of [1, 2]) {
      const mine = bundled.filter(p => p.id === id);
      expect(mine.at(-1)!.lane).toBe(0);
      expect(mine[0].lane).not.toBe(0);
      expect(mine.at(-1)!.coords.at(-1)).toEqual(EAST);
    }
  });
});
