// LIRR at Stony Brook: static schedule (data/lirr-stony-brook.json) merged with GTFS-realtime.
import { CAMPUS_TZ } from "./time";

type StationTimes = { arr: number; dep: number }; // minutes after the service day's midnight

export interface LirrTrip {
  tripId: string;
  serviceId: string;
  train: string;
  branch: string;
  color: string;
  direction: "west" | "east";
  headsign: string;
  origin: string;
  terminal: string;
  startsHere: boolean;
  endsHere: boolean;
  at: Partial<Record<"stonyBrook" | "penn" | "grandCentral" | "jamaica" | "portJefferson", StationTimes>>;
}

export interface LirrSchedule {
  builtAt: string;
  feedVersion: string | null;
  validFrom: string;
  validTo: string;
  station: { id: string; name: string; lat: number; lng: number };
  services: Record<string, { add: string[]; remove: string[] }>;
  trips: LirrTrip[];
}

export interface RealtimeTrip {
  canceled: boolean;
  delaySec: number | null; // at Stony Brook
}
export type RealtimeMap = Record<string, RealtimeTrip>; // key: `${tripId}|${startDate}`

export interface LirrTrain {
  key: string;
  tripId: string;
  train: string;
  branch: string;
  color: string;
  direction: "west" | "east";
  destination: string;
  origin: string;
  serviceDate: string;
  scheduled: number; // epoch ms at Stony Brook (departure, or arrival for terminating trains)
  expected: number; // scheduled + delay
  delayMin: number | null; // null = no realtime for this trip
  canceled: boolean;
  /** Expected times at key stations, epoch ms. */
  stations: Partial<Record<keyof LirrTrip["at"], number>>;
}

// Epoch ms of a wall-clock time in New York on a given service date (handles DST).
export function campusTime(yyyymmdd: string, minutes: number) {
  const y = Number(yyyymmdd.slice(0, 4)), m = Number(yyyymmdd.slice(4, 6)) - 1, d = Number(yyyymmdd.slice(6, 8));
  const guess = Date.UTC(y, m, d, 0, 0) + minutes * 60_000;
  // Offset of New York from UTC at that instant, e.g. -240 minutes in summer.
  const offset = (t: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: CAMPUS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(t).map(p => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return (asUtc - Math.floor(t / 60_000) * 60_000) / 60_000;
  };
  const first = guess - offset(guess) * 60_000;
  return guess - offset(first) * 60_000;
}

export function campusDate(t: number, deltaDays = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: CAMPUS_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(t + deltaDays * 86_400_000).map(p => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function runsOn(schedule: LirrSchedule, serviceId: string, date: string) {
  const s = schedule.services[serviceId];
  return !!s && s.add.includes(date) && !s.remove.includes(date);
}

function destinationOf(t: LirrTrip) {
  if (t.direction === "east") return t.terminal;
  // Westbound trains show the city terminal they reach.
  if (t.at.grandCentral) return "Grand Central";
  if (t.at.penn) return "Penn Station";
  // e.g. weekend Port Jefferson shuttles end at Huntington, where riders change for the city.
  return `${t.terminal} · change for NYC`;
}

export interface TrainQuery {
  now: number;
  kind: "departures" | "arrivals";
  direction?: "west" | "east";
  limit?: number;
  windowMin?: number;
}

/** Upcoming trains at Stony Brook, with realtime merged in when available. */
export function upcomingTrains(schedule: LirrSchedule, rt: RealtimeMap | null, q: TrainQuery): LirrTrain[] {
  const out: LirrTrain[] = [];
  const windowEnd = q.now + (q.windowMin ?? 6 * 60) * 60_000;
  // Yesterday's service day covers after-midnight trips (GTFS times past 24:00).
  for (const delta of [-1, 0, 1]) {
    const date = campusDate(q.now, delta);
    for (const t of schedule.trips) {
      if (q.direction && t.direction !== q.direction) continue;
      const sb = t.at.stonyBrook;
      if (!sb) continue;
      if (q.kind === "departures" && t.endsHere) continue;
      if (q.kind === "arrivals" && t.startsHere) continue;
      if (!runsOn(schedule, t.serviceId, date)) continue;
      const scheduled = campusTime(date, q.kind === "departures" ? sb.dep : sb.arr);
      const live = rt?.[`${t.tripId}|${date}`];
      const delayMs = (live?.delaySec ?? 0) * 1000;
      const expected = scheduled + delayMs;
      if (expected < q.now - 60_000 || scheduled > windowEnd) continue;
      const stations: LirrTrain["stations"] = {};
      for (const [k, v] of Object.entries(t.at)) stations[k as keyof LirrTrip["at"]] = campusTime(date, v.arr) + delayMs;
      out.push({
        key: `${t.tripId}|${date}`,
        tripId: t.tripId,
        train: t.train,
        branch: t.branch,
        color: t.color,
        direction: t.direction,
        destination: q.kind === "arrivals" ? `from ${t.origin}` : destinationOf(t),
        origin: t.origin,
        serviceDate: date,
        scheduled,
        expected,
        delayMin: live ? Math.round((live.delaySec ?? 0) / 60) : null,
        canceled: live?.canceled ?? false,
        stations,
      });
    }
  }
  return out.sort((a, b) => a.expected - b.expected).slice(0, q.limit ?? 8);
}
