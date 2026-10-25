import { describe, expect, it } from "vitest";
import { meters } from "./geo";
import { laneSpacingPx, metersPerPixel, offsetLine } from "./laneOffset";
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
