// ETA Spot client. Raw types mirror data/samples/etaspot-*.json.
import polyline from "@mapbox/polyline";
import type { BusRoute, BusStop, Bus, StopEta } from "./types";

const BASE = "https://stonybrook.etaspot.net/service.php";
const TOKEN = "TESTING";

export interface RawRoute {
  id: number;
  name: string;
  abbr: string;
  stops: number[];
  vType: string;
  color: string;
  encLine: string;
  type: string;
  order: number;
}

export interface RawStop {
  rid: number;
  rsid: number;
  id: number;
  name: string;
  lat: number;
  lng: number;
  extID: string;
  shortName: string;
}

export interface RawVehicle {
  routeID: number;
  patternID: number;
  equipmentID: string;
  tripID: string | null;
  lat: number;
  lng: number;
  load: number;
  capacity: number;
  blockID: number;
  nextStopID: number;
  nextStopETA: number;
  h: number;
  lastStopID: number;
  scheduleNumber: string;
  inService: 0 | 1;
  onSchedule: number | null;
  vehicleType: string;
  receiveTime: number;
  deadHead: number;
  // Same fields as per-stop ETAs (verified in data/samples/etaspot-vehicles-live-1430.json).
  minutesToNextStops: Array<Partial<RawEtaEntry>>;
}

export interface RawEtaEntry {
  minutes: number;
  timePoint: number;
  routeID: number;
  scheduleNumber: string;
  stopID: number;
  patternStopID: number;
  time: string;
  schedule: string;
  status: string;
  track: number;
  direction: string;
  directionAbbr: string;
  equipmentID: string; // "-" when the trip has no bus assigned yet (schedule only)
}

export class UpstreamError extends Error {}

async function call<T>(service: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ service, ...params, token: TOKEN });
  let res: Response;
  try {
    res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  } catch (err) {
    throw new UpstreamError(`ETA Spot unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new UpstreamError(`ETA Spot ${service} returned ${res.status}`);
  const body = await res.json();
  if (!(service in body)) throw new UpstreamError(`ETA Spot ${service}: unexpected response`);
  return body[service] as T;
}

export function normalizeRoutes(raw: RawRoute[]): BusRoute[] {
  return raw
    .filter(r => r.stops.length >= 2) // drops placeholders like "Charter"
    .map(r => ({
      id: r.id,
      name: r.name.trim(),
      abbr: r.abbr,
      color: r.color || "#B8862B",
      stopIds: r.stops,
      // polyline gives [lat, lng]; GeoJSON wants [lng, lat]
      shape: polyline.decode(r.encLine).map(([lat, lng]) => [lng, lat] as [number, number]),
    }));
}

export function normalizeStops(raw: RawStop[]): BusStop[] {
  const byId = new Map<number, BusStop>();
  for (const s of raw) {
    const existing = byId.get(s.id);
    if (existing) {
      if (!existing.routeIds.includes(s.rid)) existing.routeIds.push(s.rid);
      continue;
    }
    byId.set(s.id, { id: s.id, name: s.name.trim(), shortName: s.shortName, lat: s.lat, lng: s.lng, routeIds: [s.rid] });
  }
  return [...byId.values()];
}

export function normalizeVehicles(raw: RawVehicle[]): Bus[] {
  return raw.map(v => ({
    id: v.equipmentID,
    routeId: v.routeID,
    lat: v.lat,
    lng: v.lng,
    heading: v.h,
    nextStopId: v.nextStopID || null,
    inService: v.inService === 1,
    load: v.capacity ? v.load / v.capacity : null,
    receivedAt: v.receiveTime,
    upcoming: (v.minutesToNextStops ?? [])
      .filter(e => typeof e.stopID === "number" && typeof e.minutes === "number")
      .map(e => ({ stopId: e.stopID!, minutes: e.minutes! })),
  }));
}

export function normalizeEtas(stopId: number, raw: RawEtaEntry[], now = Date.now()): StopEta[] {
  return raw.map(e => ({
    stopId,
    routeId: e.routeID,
    tripKey: e.scheduleNumber,
    busId: e.equipmentID && e.equipmentID !== "-" ? e.equipmentID : null,
    minutes: e.minutes,
    arrivesAt: now + e.minutes * 60_000,
    scheduled: e.schedule,
    direction: e.direction,
  }));
}

export async function getRoutes() {
  return normalizeRoutes(await call<RawRoute[]>("get_routes"));
}

export async function getStops() {
  return normalizeStops(await call<RawStop[]>("get_stops"));
}

export async function getVehicles(includeOutOfService = false) {
  const raw = await call<RawVehicle[]>("get_vehicles", {
    includeETAData: "1",
    inService: includeOutOfService ? "0" : "1",
    orderedETAArray: "1",
  });
  return { raw, buses: normalizeVehicles(raw) };
}

// get_stop_etas only accepts one stop per call (a comma list returns nothing).
export async function getStopEtas(stopId: number) {
  const res = await call<Array<{ id: string; enRoute: RawEtaEntry[] }>>("get_stop_etas", {
    stopID: String(stopId),
    statusData: "1",
  });
  return normalizeEtas(stopId, res[0]?.enRoute ?? []);
}
