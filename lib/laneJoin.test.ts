import { describe, expect, it } from "vitest";
import { joinLanes } from "./laneJoin";
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
