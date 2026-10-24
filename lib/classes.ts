// Class schedule, stored locally on the device.
import type { DayKey } from "./time";

export interface ClassEntry {
  id: string;
  course: string; // "CSE 214"
  title?: string;
  days: DayKey[];
  start: string; // "HH:MM" 24h
  end?: string;
  building?: string; // as written on the schedule
  room?: string;
  placeId: string | null; // matched campus place
}

export const NO_CLASSES: ClassEntry[] = [];
const ORDER: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The next class starting after `now` (campus time), within a week. */
export function nextClass(classes: ClassEntry[], now: Date, campusClock: (d: Date) => { day: number; minutes: number }) {
  const { day, minutes } = campusClock(now);
  let best: { cls: ClassEntry; inMinutes: number } | null = null;
  for (const cls of classes) {
    if (!cls.placeId) continue;
    const [h, m] = cls.start.split(":").map(Number);
    const start = h * 60 + m;
    for (const d of cls.days) {
      let delta = (ORDER.indexOf(d) - day + 7) % 7;
      if (delta === 0 && start <= minutes) delta = 7;
      const inMinutes = delta * 1440 + start - minutes;
      if (!best || inMinutes < best.inMinutes) best = { cls, inMinutes };
    }
  }
  return best;
}
