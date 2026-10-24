// Stony Brook runs on New York time. ETA Spot reports stop ETAs as minutes since local midnight,
// so every countdown has to be computed against the campus clock, not the server's (Vercel is UTC).
export const CAMPUS_TZ = "America/New_York";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ,
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** Minutes since campus midnight (fractional) for a given instant. */
export function campusMinutes(nowMs: number): number {
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute") + get("second") / 60;
}

/**
 * Turn an ETA Spot "minutes since midnight" value into minutes from now.
 * Handles buses whose next stop is just past midnight. Returns null for "no ETA" (-1).
 */
export function minutesUntil(etaMinutesOfDay: number, nowMs: number): number | null {
  if (!Number.isFinite(etaMinutesOfDay) || etaMinutesOfDay < 0) return null;
  let diff = etaMinutesOfDay - campusMinutes(nowMs);
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return Math.max(0, diff);
}

/** "12:42 PM" for an ETA Spot minutes-of-day value. */
export function clockLabel(etaMinutesOfDay: number): string {
  const m = ((Math.round(etaMinutesOfDay) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
