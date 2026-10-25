import { describe, expect, it } from "vitest";
import { meters } from "./geo";
import { RoadGraph, type RoadGraphFile } from "./roadMatch";
import type { LngLat } from "./types";

// An L-shaped two-way road: 0 → 1 (north) → 2 (east).
const file: RoadGraphFile = {
  source: "test", bbox: "",
  nodes: [[-73.13, 40.91], [-73.13, 40.912], [-73.127, 40.912]],
  segs: [0, 1, 1, 0, 1, 2, 2, 1],
};

describe("RoadGraph.match", () => {
  it("follows the road around a corner instead of cutting it", () => {
    // A coarse route line that cuts the corner with a chord ~20 m inside it, like ETA Spot's lines.
    const coarse: LngLat[] = [[-73.13, 40.9101], [-73.13, 40.9115], [-73.1295, 40.912], [-73.1271, 40.912]];
    expect(Math.min(...coarse.map(p => meters(p, [-73.13, 40.912])))).toBeGreaterThan(40);
    const snapped = new RoadGraph(file).match(coarse);
    // Somewhere it passes close to the corner (rounded, so within a few meters), not 60 m inside it.
    const nearCorner = Math.min(...snapped.map(p => meters(p, [-73.13, 40.912])));
    expect(nearCorner).toBeLessThan(10);
  });

  it("keeps points that are far from any road as they are", () => {
    const off: LngLat[] = [[-73.0, 40.95], [-73.001, 40.951]];
    expect(new RoadGraph(file).match(off)[0]).toEqual([-73, 40.95]);
  });
});

describe("removeSpurs", () => {
  it("cuts a short out-and-back detour but keeps a real loop", async () => {
    const { removeSpurs } = await import("./roadMatch");
    const step = (lng: number, lat: number): LngLat => [-73.13 + lng * 1e-4, 40.91 + lat * 1e-4];
    // East along a road, a 30 m jog north up a side street and back, then onward east.
    const spur = [step(0, 0), step(1, 0), step(1, 1.4), step(1, 2.7), step(1, 1.4), step(1.02, 0), step(2, 0)];
    expect(removeSpurs(spur).some(p => p[1] > 40.91 + 1e-4)).toBe(false);
    // A ~170 m loop that returns to its start is kept.
    const loop = [step(0, 0), step(4, 0), step(4, 4), step(0, 4), step(0, 0.2)];
    expect(removeSpurs(loop)).toHaveLength(loop.length);
  });
});
