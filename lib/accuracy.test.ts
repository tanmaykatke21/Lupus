import { describe, expect, it } from "vitest";
import { evaluate, type AccuracyRow } from "./accuracy";

const row = (i: number, over: Partial<AccuracyRow> = {}): AccuracyRow =>
  ({ time: i * 60_000, routeId: 3, stopId: 1, horizonMin: 5, hour: 22, errorSec: 0, ...over });

describe("evaluate", () => {
  it("learns a consistent late bias only from the training period", () => {
    // Buses are always ~120 s later than ETA Spot says, give or take 10 s.
    const rows = Array.from({ length: 100 }, (_, i) => row(i, { errorSec: 120 + (i % 3) * 10 - 10 }));
    const r = evaluate(rows);
    expect(r.trainRows).toBe(70);
    expect(r.testRows).toBe(30);
    expect(r.etaSpot.mae).toBeGreaterThan(100);
    expect(r.lupus.mae).toBeLessThan(15);
    expect(r.etaSpot.n).toBe(r.lupus.n);
  });

  it("does not leak test data into training", () => {
    // Training period has no bias; the test period suddenly runs late. Lupus can't know that.
    const rows = Array.from({ length: 100 }, (_, i) => row(i, { errorSec: i < 70 ? 0 : 200 }));
    const r = evaluate(rows);
    expect(r.lupus.mae).toBeCloseTo(r.etaSpot.mae, 5);
  });

  it("falls back to coarser groups when a route/hour has too few samples", () => {
    const rows = [
      ...Array.from({ length: 70 }, (_, i) => row(i, { routeId: 4, hour: 9, errorSec: 60 })),
      ...Array.from({ length: 30 }, (_, i) => row(70 + i, { routeId: 3, hour: 22, errorSec: 60 })),
    ];
    expect(evaluate(rows).lupus.mae).toBeCloseTo(0, 5); // uses the horizon-wide mean
  });

  it("handles no data", () => {
    expect(evaluate([]).testRows).toBe(0);
  });
});
