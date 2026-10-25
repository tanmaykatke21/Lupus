import { FULL_LOAD } from "./router";

export interface Crowding { label: string; tone: "ok" | "warn" | "danger" }

/** Seats / busy / packed from ETA Spot's load ÷ capacity; null when the bus isn't tracked yet. */
export function crowding(load: number | null | undefined): Crowding | null {
  if (load === null || load === undefined) return null;
  const pct = Math.round(load * 100);
  if (load >= FULL_LOAD) return { label: `Full (${pct}% of seats)`, tone: "danger" };
  if (load >= 1) return { label: "Standing room only", tone: "warn" };
  if (load >= 0.75) return { label: `Busy (${pct}% of seats)`, tone: "warn" };
  return { label: pct < 40 ? "Plenty of seats" : `Seats (${pct}%)`, tone: "ok" };
}

/** "Outer Loop bus 61 is full, so we're taking the next one." */
export function skippedNote(s: { routeName: string; busId: string | null; demo: boolean }) {
  return `${s.routeName}${s.busId ? ` bus ${s.busId}` : ""} is full${s.demo ? " (demo)" : ""}, so Lupus picked the next best way.`;
}
