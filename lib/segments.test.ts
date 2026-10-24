import { describe, expect, it } from "vitest";
import { historicalRideMinutes, reliabilityNote } from "./segments";
import type { BusRoute } from "./types";

const route: BusRoute = { id: 3, name: "Outer Loop", abbr: "Outer", color: "#000", stopIds: [1, 9, 17, 19], shape: [] };

describe("historicalRideMinutes", () => {
  const table = {
    "3|1|9|10": { avg: 60, n: 5 },
    "3|9|17|*": { avg: 90, n: 12 },
    "3|17|19|10": { avg: 30, n: 1 }, // too few for this hour…
    "3|17|19|*": { avg: 150, n: 9 }, // …so the all-hours average is used
    "3|19|1|*": { avg: 120, n: 4 },
  };
  it("sums segments along the route, preferring the same hour", () => {
    expect(historicalRideMinutes(table, route, 1, 19, 10)).toBe(5); // 60 + 90 + 150 s
  });
  it("wraps around loops", () => {
    expect(historicalRideMinutes(table, route, 19, 9, 10)).toBe(3); // 120 + 60 s
  });
  it("returns null when any segment lacks history", () => {
    expect(historicalRideMinutes(table, route, 1, 9, 14)).toBeNull();
  });
});

describe("reliabilityNote", () => {
  it("describes lateness only with enough samples", () => {
    expect(reliabilityNote({ "3|22": { avg: 130, n: 20 } }, 3, 22)).toBe("Usually 2 min later than shown late at night");
    expect(reliabilityNote({ "3|22": { avg: 130, n: 2 } }, 3, 22)).toBeNull();
    expect(reliabilityNote({ "3|12": { avg: 10, n: 9 } }, 3, 12)).toBe("Usually on time around now");
  });
});
