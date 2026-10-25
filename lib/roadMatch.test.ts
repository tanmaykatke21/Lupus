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


describe("detour removal", () => {
  // A crossroads: west-east street and a north-south street meeting at node 1.
  const cross: RoadGraphFile = {
    source: "test", bbox: "",
    nodes: [[-73.13, 40.91], [-73.128, 40.91], [-73.126, 40.91], [-73.128, 40.9115], [-73.128, 40.9085]],
    segs: [0, 1, 1, 0, 1, 2, 2, 1, 1, 3, 3, 1, 1, 4, 4, 1],
  };

  it("drops a brief excursion onto the cross street at an intersection", () => {
    // Straight through the junction, with a few points that wander north toward the cross street.
    const wobbly: LngLat[] = [[-73.1299, 40.91], [-73.1281, 40.91005], [-73.12805, 40.9102], [-73.1279, 40.91002], [-73.1261, 40.91]];
    const snapped = new RoadGraph(cross).match(wobbly);
    expect(Math.max(...snapped.map(p => p[1]))).toBeLessThan(40.91 + 2e-5); // never goes up the side street
  });

  it("keeps a real turn onto the cross street", () => {
    const turn: LngLat[] = [[-73.1299, 40.91], [-73.1281, 40.91], [-73.128, 40.9108], [-73.128, 40.9114]];
    const snapped = new RoadGraph(cross).match(turn);
    expect(snapped.at(-1)![1]).toBeGreaterThan(40.911);
  });
});
