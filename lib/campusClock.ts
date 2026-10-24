import { CAMPUS_TZ } from "./campusTime";

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: CAMPUS_TZ, hour: "numeric", minute: "2-digit" });

/** "2:45 PM" on the campus clock, for an instant `minutesFromNow` after `baseMs`. */
export function clockAfter(baseMs: number, minutesFromNow: number): string {
  return fmt.format(new Date(baseMs + minutesFromNow * 60_000));
}

/** "4 min", "1 min", "<1 min". */
export function minLabel(min: number): string {
  if (min < 1) return "<1 min";
  return `${Math.round(min)} min`;
}
