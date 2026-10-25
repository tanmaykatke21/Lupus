import { describe, expect, it } from "vitest";
import { BASE, directionalLanes } from "./directionalLanes";
import { offsetLineVar } from "./laneOffset";

// An east-west road ~850 m long.
const W: [number, number] = [-73.13, 40.912];
const E: [number, number] = [-73.12, 40.912];
const mid = (l: { lanes: number[] }) => l.lanes[Math.floor(l.lanes.length / 2)];
/** Latitude of a line's middle once drawn (right of travel = south when heading east). */
const drawnLat = (l: { coords: [number, number][]; lanes: number[] }) => {
  const pts = offsetLineVar(l.coords, l.lanes.map(x => x * 5));
  return pts[Math.floor(pts.length / 2)][1];
};

describe("directionalLanes", () => {
  it("centers a route that has the road to itself", () => {
    expect(mid(directionalLanes([{ id: 1, coords: [W, E] }])[0])).toBe(0);
  });

  it("stacks routes going the same way close together, one lane apart", () => {
    const [a, b] = directionalLanes([{ id: 1, coords: [W, E] }, { id: 2, coords: [W, E] }]);
    expect(mid(a)).toBe(-0.5);
    expect(mid(b)).toBe(0.5);
  });

  it("puts opposite directions on opposite sides, far apart", () => {
    const [east, west] = directionalLanes([{ id: 1, coords: [W, E] }, { id: 2, coords: [E, W] }]);
    expect(mid(east)).toBe(BASE);
    expect(mid(west)).toBe(BASE);
    // Each keeps right of its own travel, so they end up on opposite sides of the road.
    expect(drawnLat(east)).toBeLessThan(40.912);
    expect(drawnLat(west)).toBeGreaterThan(40.912);
  });

  it("separates a route's own coming and going", () => {
    const [loop] = directionalLanes([{ id: 1, coords: [W, E, W] }]);
    const n = loop.lanes.length;
    expect(loop.lanes[Math.floor(n * 0.25)]).toBe(BASE);
    expect(loop.lanes[Math.floor(n * 0.75)]).toBe(BASE);
  });

  it("keeps same-direction routes together on their side when the other direction is present", () => {
    const [a, b, c] = directionalLanes([{ id: 1, coords: [W, E] }, { id: 2, coords: [W, E] }, { id: 3, coords: [E, W] }]);
    expect([mid(a), mid(b)]).toEqual([BASE, BASE + 1]); // adjacent, same side
    expect(mid(c)).toBe(BASE); // alone on the other side
  });

  it("gives both ends of a closed loop the same lane (no gap at the join)", () => {
    const N: [number, number] = [-73.12, 40.92];
    const [a] = directionalLanes([{ id: 1, coords: [W, E, N, W] }, { id: 2, coords: [E, N] }]);
    expect(a.lanes[0]).toBe(a.lanes.at(-1));
  });
});
