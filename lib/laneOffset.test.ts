import { describe, expect, it } from "vitest";
import { meters } from "./geo";
import { drawLane, laneUnitPx, lineWidthPx, metersPerPixel, offsetLineVar } from "./laneOffset";
import { smallLoops } from "./loopFinder";
import type { LngLat } from "./types";

describe("offsetLine", () => {
  const eastward: LngLat[] = [[-73.13, 40.912], [-73.12, 40.912]];

  it("shifts to the right of travel by the given meters", () => {
    const shifted = offsetLineVar(eastward, [10, 10]);
    expect(shifted[0][1]).toBeLessThan(40.912); // heading east, right is south
    expect(meters(eastward[0], shifted[0])).toBeCloseTo(10, 0);
    expect(offsetLineVar(eastward, [-10, -10])[0][1]).toBeGreaterThan(40.912);
  });

  it("scales lines and lanes with zoom, lanes always a hair wider than a line", () => {
    expect(lineWidthPx(14)).toBe(2);
    expect(lineWidthPx(17)).toBeCloseTo(3.5);
    expect(laneUnitPx(16)).toBe(3.5);
    expect(metersPerPixel(40.91, 16)).toBeCloseTo(1.8, 1);
  });
});

describe("drawLane", () => {
  it("doesn't fold into a loop on the inside of a sharp turn", () => {
    // 100 m east, then a left turn and 100 m north, in 5 m steps. Offset 30 m to the left (the inside).
    const o: LngLat = [-73.13, 40.912];
    const at = (x: number, y: number): LngLat => [o[0] + x / 84_180, o[1] + y / 110_540];
    const line: LngLat[] = [];
    for (let x = 0; x <= 100; x += 5) line.push(at(x, 0));
    for (let y = 5; y <= 100; y += 5) line.push(at(100, y));
    const lanes = line.map(() => -1);
    expect(smallLoops(offsetLineVar(line, lanes.map(x => x * 30))).length).toBeGreaterThan(0); // the problem
    expect(smallLoops(drawLane(line, lanes, 30))).toHaveLength(0); // fixed
  });
});
