// Campus wall-clock helpers. Servers run in UTC; Stony Brook runs on America/New_York.
export const CAMPUS_TZ = "America/New_York";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAYS)[number];

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function campusClock(at: Date) {
  const parts = Object.fromEntries(fmt.formatToParts(at).map(p => [p.type, p.value]));
  const day = DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 3) as DayKey);
  return { day, dayKey: DAYS[day], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const hhmm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: CAMPUS_TZ, hour: "numeric", minute: "2-digit" });
}
