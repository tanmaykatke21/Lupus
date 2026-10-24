// Pure helpers over Tiger Data aggregates (no DB access here, so they're testable).
import type { BusRoute } from "./types";

export interface Stat { avg: number; n: number }
export type SegmentTable = Record<string, Stat>; // `${route}|${from}|${to}|${hour or *}`
export type LatenessTable = Record<string, Stat>; // `${route}|${hour}`

const MIN_SAMPLES = 3;

/** Minutes from board to alight by summing historical segment averages along the route. */
export function historicalRideMinutes(table: SegmentTable, route: BusRoute, from: number, to: number, hour: number) {
  const ids = route.stopIds;
  const i = ids.indexOf(from), j = ids.indexOf(to);
  if (i === -1 || j === -1 || i === j) return null;
  let total = 0;
  for (let k = i; k !== j; k = (k + 1) % ids.length) {
    const a = ids[k], b = ids[(k + 1) % ids.length];
    const s = [table[`${route.id}|${a}|${b}|${hour}`], table[`${route.id}|${a}|${b}|*`]].find(x => x && x.n >= MIN_SAMPLES);
    if (!s) return null; // a gap in history: let the schedule answer instead
    total += s.avg;
  }
  return total / 60;
}

/** "usually 2 min late after 10 PM"-style note for a route at an hour, or null without enough data. */
export function reliabilityNote(table: LatenessTable, routeId: number, hour: number): string | null {
  const s = table[`${routeId}|${hour}`];
  if (!s || s.n < 5) return null;
  const min = Math.round(s.avg / 60);
  const when = hour >= 21 || hour < 5 ? "late at night" : hour >= 17 ? "in the evening" : hour < 10 ? "in the morning" : "around now";
  if (min >= 1) return `Usually ${min} min later than shown ${when}`;
  if (min <= -1) return `Often ${-min} min early ${when}`;
  return `Usually on time ${when}`;
}
