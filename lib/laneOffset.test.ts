import { describe, expect, it } from "vitest";
import { meters } from "./geo";
import { closeGaps, laneSpacingPx, metersPerPixel, offsetLine } from "./laneOffset";
import type { LngLat } from "./types";

describe("offsetLine", () => {
  const eastward: LngLat[] = [[-73.13, 40.912], [-73.12, 40.912]];

  it("shifts to the right of travel by the given meters", () => {
    const shifted = offsetLine(eastward, 10);
    expect(shifted[0][1]).toBeLessThan(40.912); // heading east, right is south
    expect(meters(eastward[0], shifted[0])).toBeCloseTo(10, 0);
    expect(offsetLine(eastward, -10)[0][1]).toBeGreaterThan(40.912);
  });

  it("matches the MapLibre spacing curve and Mercator scale", () => {
    expect(laneSpacingPx(15)).toBeCloseTo(5.6);
    expect(laneSpacingPx(16.5)).toBeCloseTo(7.55, 2);
    expect(metersPerPixel(40.91, 16)).toBeCloseTo(1.8, 1);
  });
});

describe("closeGaps", () => {
  const M = 1 / 110_540; // one meter north, in degrees
  const a: [number, number][] = [[-73.13, 40.912], [-73.125, 40.912]];
  // The same route carries on 4 m north of where its first line stops.
  const b: [number, number][] = [[-73.125, 40.912 + 4 * M], [-73.12, 40.912 + 4 * M]];

  it("joins a route's loose end to the rest of it", () => {
    const [joinedA] = closeGaps([{ id: 1, path: a }, { id: 1, path: b }], 10);
    expect(joinedA).toHaveLength(3);
    expect(joinedA[2][1]).toBeCloseTo(40.912 + 4 * M, 9);
  });

  it("leaves ends alone that are too far, or belong to another route", () => {
    expect(closeGaps([{ id: 1, path: a }, { id: 1, path: b }], 2)[0]).toHaveLength(2);
    expect(closeGaps([{ id: 1, path: a }, { id: 2, path: b }], 10)[0]).toHaveLength(2);
  });
});
