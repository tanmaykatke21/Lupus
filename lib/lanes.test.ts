import { describe, expect, it } from "vitest";
import { laneRoutes } from "./lanes";

// A straight east-west road on campus, about 800 m long.
const WEST: [number, number] = [-73.13, 40.912];
const EAST: [number, number] = [-73.12, 40.912];
const NORTH_END: [number, number] = [-73.12, 40.92];

const lanesOf = (pieces: ReturnType<typeof laneRoutes>, id: number) => [...new Set(pieces.filter((p) => p.id === id).map((p) => p.lane))];

describe("laneRoutes", () => {
  it("leaves a route alone on its own road", () => {
    const pieces = laneRoutes([{ id: 1, coords: [WEST, EAST] }]);
    expect(lanesOf(pieces, 1)).toEqual([0]);
  });

  it("puts two routes on the same road in neighboring lanes", () => {
    const pieces = laneRoutes([
      { id: 2, coords: [WEST, EAST] },
      { id: 1, coords: [WEST, EAST] },
    ]);
    expect(lanesOf(pieces, 1)).toEqual([-0.5]);
    expect(lanesOf(pieces, 2)).toEqual([0.5]);
  });

  it("keeps routes driving opposite ways in separate lanes", () => {
    // Offsets are relative to each piece's own direction, so the reversed route's sign flips:
    // -0.5 going west is the same side of the road as +0.5 going east, away from route 1.
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST] },
      { id: 2, coords: [EAST, WEST] },
    ]);
    expect(lanesOf(pieces, 1)).toEqual([-0.5]);
    expect(lanesOf(pieces, 2)).toEqual([-0.5]);
  });

  it("draws an out-and-back route's road once, in one lane", () => {
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST, WEST] },
      { id: 2, coords: [WEST, EAST] },
    ]);
    const mine = pieces.filter((p) => p.id === 1);
    // The way back covers the same road in the same lane, so only the way out is drawn.
    expect(mine.every((p) => p.coords[0][0] < p.coords[1][0])).toBe(true);
    expect(new Set(mine.map((p) => p.lane))).toEqual(new Set([-0.5]));
    expect(lanesOf(pieces, 2)).toEqual([0.5]);
  });

  it("still pairs a route with an out-and-back route on its way back", () => {
    // Route 2 only drives the road westbound, alongside route 1's return trip.
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST, WEST] },
      { id: 2, coords: [EAST, WEST] },
    ]);
    expect(new Set(lanesOf(pieces, 1))).toEqual(new Set([-0.5]));
    // Opposite direction to route 1's first pass, so -0.5 here is the far side from route 1.
    expect(lanesOf(pieces, 2)).toEqual([-0.5]);
  });

  it("only uses lanes where the routes actually overlap", () => {
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST, NORTH_END] },
      { id: 2, coords: [WEST, EAST] },
    ]);
    // Route 1 shares the east-west road, then has the northbound road to itself.
    expect(new Set(lanesOf(pieces, 1))).toEqual(new Set([-0.5, 0]));
    const northbound = pieces.filter((p) => p.id === 1 && p.lane === 0);
    expect(northbound.every((p) => p.coords.every((c) => c[0] === EAST[0]))).toBe(true);
  });

  it("gives three routes on one road three lanes", () => {
    const pieces = laneRoutes([3, 1, 2].map((id) => ({ id, coords: [WEST, EAST] })));
    expect([1, 2, 3].map((id) => lanesOf(pieces, id))).toEqual([[-1], [0], [1]]);
  });
});
