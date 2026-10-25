import { describe, expect, it } from "vitest";
import { meters } from "./geo";
import { buildWalkGraph, walkRoute, type WalkData } from "./walkRoute";

// A small made-up path network near campus: a grid of paths 50 m apart.
const LAT0 = 40.912;
const LNG0 = -73.123;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
const at = (xm: number, ym: number) => ({ lng: LNG0 + xm / KX, lat: LAT0 + ym / KY });

/** Grid of size×size points 50 m apart, without the points listed in `holes` (as "col,row"). */
function grid(size: number, holes: string[] = []): WalkData {
  const index = new Map<string, number>();
  const nodes: number[] = [];
  for (let c = 0; c < size; c++)
    for (let r = 0; r < size; r++) {
      if (holes.includes(`${c},${r}`)) continue;
      const p = at(c * 50, r * 50);
      index.set(`${c},${r}`, nodes.length / 2);
      nodes.push(Math.round(p.lng * 1e6), Math.round(p.lat * 1e6));
    }
  const edges: number[] = [];
  for (const [key, i] of index) {
    const [c, r] = key.split(",").map(Number);
    for (const nb of [`${c + 1},${r}`, `${c},${r + 1}`]) {
      const j = index.get(nb);
      if (j !== undefined) edges.push(i, j);
    }
  }
  return { version: 1, nodes, edges };
}

const pathLength = (coords: [number, number][]) =>
  coords.slice(1).reduce((sum, c, i) => sum + meters({ lng: coords[i][0], lat: coords[i][1] }, { lng: c[0], lat: c[1] }), 0);

describe("walkRoute", () => {
  it("walks straight along a path when nothing is in the way", () => {
    const g = buildWalkGraph(grid(5))!;
    const r = walkRoute(g, at(0, 100), at(200, 100))!;
    expect(r.meters).toBeCloseTo(200, 0);
    expect(r.coords[0]).toEqual([at(0, 100).lng, at(0, 100).lat]);
  });

  it("marks where paths meet along the route", () => {
    const g = buildWalkGraph(grid(5))!;
    const r = walkRoute(g, at(0, 100), at(200, 100))!;
    // Every inner grid point on the middle row is a crossing of four paths; the edge points of a row meet three.
    expect(r.junctions.length).toBeGreaterThanOrEqual(3);
    expect(r.junctions.every((i) => i > 0 && i < r.coords.length)).toBe(true);
  });

  it("goes around a building instead of through it", () => {
    // The middle of the grid is a building with no paths through it.
    const g = buildWalkGraph(grid(5, ["2,2", "1,2", "3,2"]))!;
    const from = at(0, 100);
    const to = at(200, 100);
    const r = walkRoute(g, from, to)!;
    // Straight across would be 200 m; the way around goes up a row and back down: 300 m.
    expect(r.meters).toBeCloseTo(300, 0);
    expect(pathLength(r.coords)).toBeCloseTo(r.meters, 0);
    // No point of the route is inside the building row.
    const blocked = r.coords.filter(([lng, lat]) => {
      const x = (lng - LNG0) * KX;
      const y = (lat - LAT0) * KY;
      return Math.abs(y - 100) < 1 && x > 25 && x < 175;
    });
    expect(blocked).toEqual([]);
  });

  it("joins each end onto the nearest path", () => {
    const g = buildWalkGraph(grid(5))!;
    // Both ends 20 m off the grid's west and east edges.
    const r = walkRoute(g, at(-20, 100), at(220, 100))!;
    expect(r.meters).toBeCloseTo(240, 0);
    expect(r.coords[1][0]).toBeCloseTo(at(0, 100).lng, 6);
  });

  it("finds the shortest of several routes", () => {
    const g = buildWalkGraph(grid(6))!;
    // Diagonal across the grid: any staircase path is 500 m; nothing shorter exists on a grid.
    const r = walkRoute(g, at(0, 0), at(250, 250))!;
    expect(r.meters).toBeCloseTo(500, 0);
  });

  it("handles both ends on the same stretch of path", () => {
    const g = buildWalkGraph(grid(3))!;
    const r = walkRoute(g, at(10, 0), at(40, 0))!;
    expect(r.meters).toBeCloseTo(30, 0);
    expect(r.coords).toHaveLength(2);
  });

  it("gives up when a point is far from every path", () => {
    const g = buildWalkGraph(grid(3))!;
    expect(walkRoute(g, at(0, 0), at(5000, 0))).toBeNull();
  });

  it("gives up when the two ends are on paths that never meet", () => {
    const left = grid(2);
    // A second, separate square 1 km east, numbered after the first one's nodes.
    const right = grid(2);
    const shift = Math.round((1000 / KX) * 1e6);
    const nodes = [...left.nodes, ...right.nodes.map((v, i) => (i % 2 === 0 ? v + shift : v))];
    const edges = [...left.edges, ...right.edges.map((e) => e + left.nodes.length / 2)];
    const g = buildWalkGraph({ version: 1, nodes, edges })!;
    expect(walkRoute(g, at(0, 0), at(1000, 0))).toBeNull();
  });

  it("returns null for an empty network", () => {
    expect(buildWalkGraph({ version: 1, nodes: [], edges: [] })).toBeNull();
  });
});
