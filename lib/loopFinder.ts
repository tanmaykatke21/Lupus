// Where does a line cross itself within `maxLoopM` of path? A real turnaround loop is long;
// a short self-crossing is a drawing artifact. Used by tests and scripts/find-loops.ts.
import { meters } from "./geo";
import type { LngLat } from "./types";

function crosses(a: LngLat, b: LngLat, c: LngLat, d: LngLat) {
  const o = (p: LngLat, q: LngLat, r: LngLat) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function smallLoops(line: LngLat[], maxLoopM = 150) {
  const walked = [0];
  for (let i = 1; i < line.length; i++) walked.push(walked[i - 1] + meters(line[i - 1], line[i]));
  const found: { at: LngLat; loopM: number; i: number }[] = [];
  for (let i = 1; i < line.length; i++) {
    for (let j = i + 2; j < line.length && walked[j] - walked[i] < maxLoopM; j++) {
      if (crosses(line[i - 1], line[i], line[j - 1], line[j])) {
        found.push({ at: line[i], loopM: Math.round(walked[j] - walked[i]), i });
        break;
      }
    }
  }
  return found;
}
