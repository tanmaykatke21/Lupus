import { describe, expect, it } from "vitest";
import { laneRoutes } from "./lanes";

// A straight east-west road on campus, about 800 m long.
const WEST: [number, number] = [-73.13, 40.912];
const EAST: [number, number] = [-73.12, 40.912];
const NORTH_END: [number, number] = [-73.12, 40.92];

const lanesOf = (pieces: ReturnType<typeof laneRoutes>, id: number) => [...new Set(pieces.filter((p) => p.id === id).map((p) => p.lane))];
// Which side of the east-west road a piece is drawn on, whichever way it runs: lanes are relative to the
// direction of travel (positive = right), so going east positive is south and going west it's north.
const northOf = (p: ReturnType<typeof laneRoutes>[number]) => (p.coords[p.coords.length - 1][0] > p.coords[0][0] ? -p.lane : p.lane);
const sidesOf = (pieces: ReturnType<typeof laneRoutes>, id: number) => [...new Set(pieces.filter((p) => p.id === id).map(northOf))];

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

  it("keeps an out-and-back route's way back in the lane of its way out", () => {
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST, WEST] },
      { id: 2, coords: [WEST, EAST] },
    ]);
    // The way back covers the same road, so it's skipped (bar a short run onto it), on the same side.
    expect(sidesOf(pieces, 1)).toHaveLength(1);
    expect(sidesOf(pieces, 2)).toEqual([-sidesOf(pieces, 1)[0]]);
  });

  it("still pairs a route with an out-and-back route on its way back", () => {
    // Route 2 only drives the road westbound, alongside route 1's return trip.
    const pieces = laneRoutes([
      { id: 1, coords: [WEST, EAST, WEST] },
      { id: 2, coords: [EAST, WEST] },
    ]);
    expect(sidesOf(pieces, 1)).toHaveLength(1);
    expect(sidesOf(pieces, 2)).toEqual([-sidesOf(pieces, 1)[0]]);
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

  it("draws both sides of a divided road", () => {
    // Out on the eastbound carriageway, back on the westbound one 10 m north: two roads, not one repeated.
    const north = (c: [number, number]): [number, number] => [c[0], c[1] + 10 / 110_540];
    const pieces = laneRoutes([{ id: 1, coords: [WEST, EAST, north(EAST), north(WEST)] }]);
    const onNorthSide = pieces.flatMap((p) => p.coords).filter((c) => c[1] > WEST[1] + 5 / 110_540 && c[0] > WEST[0] + 0.001 && c[0] < EAST[0] - 0.001);
    expect(onNorthSide.length).toBeGreaterThan(10);
  });

  it("doesn't cut a loop route where it starts and ends", () => {
    // A square loop starting at the corner it shares with route 2: drawn from its far corner instead, so
    // the shared corner is in the middle of the line.
    const SW: [number, number] = [-73.13, 40.912];
    const SE: [number, number] = [-73.125, 40.912];
    const NE: [number, number] = [-73.125, 40.916];
    const NW: [number, number] = [-73.13, 40.916];
    const pieces = laneRoutes([
      { id: 1, coords: [SW, SE, NE, NW, SW] },
      { id: 2, coords: [[-73.135, 40.912], SE] },
    ]);
    const mine = pieces.filter((p) => p.id === 1);
    expect(mine[0].coords[0]).toEqual(NE);
    expect(mine.at(-1)!.coords.at(-1)).toEqual(NE);
  });

  it("gives three routes on one road three lanes", () => {
    const pieces = laneRoutes([3, 1, 2].map((id) => ({ id, coords: [WEST, EAST] })));
    expect([1, 2, 3].map((id) => lanesOf(pieces, id))).toEqual([[-1], [0], [1]]);
  });
});
