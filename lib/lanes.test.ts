import { describe, expect, it } from "vitest";
import { laneLines, laneRoutes } from "./lanes";

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

describe("laneLines (continuous)", () => {
  const W: [number, number] = [-73.13, 40.912], E: [number, number] = [-73.12, 40.912], N: [number, number] = [-73.12, 40.92];

  it("keeps each route as one unbroken line that ends where it started when the input is a loop", () => {
    const loop = { id: 1, coords: [W, E, N, W] as [number, number][] };
    const [line] = laneLines([loop]);
    expect(line.coords[0]).toEqual(W);
    expect(line.coords.at(-1)).toEqual(W);
    expect(line.lanes).toHaveLength(line.coords.length);
  });

  it("puts two routes sharing a road in opposite lanes", () => {
    const lines = laneLines([{ id: 1, coords: [W, E] }, { id: 2, coords: [W, E] }]);
    const mid = (l: (typeof lines)[number]) => l.lanes[Math.floor(l.lanes.length / 2)];
    expect(mid(lines[0])).toBe(-0.5);
    expect(mid(lines[1])).toBe(0.5);
  });

  it("draws an out-and-back on the same physical side both ways (mirrored lane), not dropped", () => {
    const lines = laneLines([{ id: 1, coords: [W, E, W] }, { id: 2, coords: [W, E] }]);
    const out = lines[0];
    const n = out.lanes.length;
    const outbound = out.lanes[Math.floor(n * 0.25)], back = out.lanes[Math.floor(n * 0.75)];
    expect(Math.abs(outbound)).toBe(0.5);
    expect(back).toBe(-outbound); // relative to its own direction, so it lands on the same side
  });
});

describe("laneLines closed loops", () => {
  it("gives both ends of a closed loop the same lane, so the join has no gap", () => {
    const W: [number, number] = [-73.13, 40.912], E: [number, number] = [-73.12, 40.912], N: [number, number] = [-73.12, 40.92];
    const [a] = laneLines([{ id: 1, coords: [W, E, N, W] }, { id: 2, coords: [E, N] }]);
    expect(a.lanes[0]).toBe(a.lanes.at(-1));
  });
});
