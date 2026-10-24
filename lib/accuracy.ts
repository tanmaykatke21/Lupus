// Accuracy study: ETA Spot's own predictions vs. a bias-corrected Lupus model, on the same trips.
//
// Method (shown on /stats):
// 1. Every time the poller sees a bus reach a stop, it stores ETA Spot's latest prediction for that
//    bus and stop made 2-5, 5-10 and 10-20 minutes earlier, and the error (actual - predicted).
// 2. Rows are split by time: the first 70% train the model, the last 30% are the test set.
//    Nothing from the test period is used for training.
// 3. Lupus model = ETA Spot's prediction + the mean training error for the same route, campus hour
//    and horizon (falling back to route+horizon, then horizon) when that group has enough samples.
// 4. Both models are scored on the identical test rows: mean absolute error, median, % within 1 min.

export interface AccuracyRow {
  time: number; // actual arrival, ms
  routeId: number;
  stopId: number;
  horizonMin: number;
  hour: number;
  errorSec: number; // actual - ETA Spot prediction
}

export interface Score { mae: number; median: number; within60: number; n: number }

export interface AccuracyReport {
  etaSpot: Score;
  lupus: Score;
  trainRows: number;
  testRows: number;
  from: number | null;
  to: number | null;
  byHorizon: { horizonMin: number; etaSpot: Score; lupus: Score }[];
}

const MIN_GROUP = 8;
const TRAIN_FRACTION = 0.7;

function score(errors: number[]): Score {
  if (!errors.length) return { mae: 0, median: 0, within60: 0, n: 0 };
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const mid = Math.floor(abs.length / 2);
  return {
    mae: abs.reduce((s, x) => s + x, 0) / abs.length,
    median: abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2,
    within60: abs.filter(x => x <= 60).length / abs.length,
    n: abs.length,
  };
}

export function trainBias(rows: AccuracyRow[]) {
  const groups = new Map<string, { sum: number; n: number }>();
  const add = (k: string, e: number) => {
    const g = groups.get(k) ?? { sum: 0, n: 0 };
    g.sum += e; g.n++;
    groups.set(k, g);
  };
  for (const r of rows) {
    add(`${r.routeId}|${r.hour}|${r.horizonMin}`, r.errorSec);
    add(`${r.routeId}|*|${r.horizonMin}`, r.errorSec);
    add(`*|*|${r.horizonMin}`, r.errorSec);
  }
  return (r: Pick<AccuracyRow, "routeId" | "hour" | "horizonMin">) => {
    for (const k of [`${r.routeId}|${r.hour}|${r.horizonMin}`, `${r.routeId}|*|${r.horizonMin}`, `*|*|${r.horizonMin}`]) {
      const g = groups.get(k);
      if (g && g.n >= MIN_GROUP) return g.sum / g.n;
    }
    return 0;
  };
}

export function evaluate(rows: AccuracyRow[]): AccuracyReport {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const cut = Math.floor(sorted.length * TRAIN_FRACTION);
  const train = sorted.slice(0, cut), test = sorted.slice(cut);
  const bias = trainBias(train);
  // Lupus predicts ETA Spot + bias, so its error is (actual - ETA Spot) - bias.
  const lupusErr = (r: AccuracyRow) => r.errorSec - bias(r);
  const horizons = [...new Set(test.map(r => r.horizonMin))].sort((a, b) => a - b);
  return {
    etaSpot: score(test.map(r => r.errorSec)),
    lupus: score(test.map(lupusErr)),
    trainRows: train.length,
    testRows: test.length,
    from: sorted[0]?.time ?? null,
    to: sorted.at(-1)?.time ?? null,
    byHorizon: horizons.map(h => {
      const t = test.filter(r => r.horizonMin === h);
      return { horizonMin: h, etaSpot: score(t.map(r => r.errorSec)), lupus: score(t.map(lupusErr)) };
    }),
  };
}
