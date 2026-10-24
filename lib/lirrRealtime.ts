// LIRR GTFS-realtime (no API key needed), reduced to delays/cancellations at Stony Brook.
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { RealtimeMap } from "./lirr";

const FEED = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr";
const STONY_BROOK = "14";
const { transit_realtime: rt } = GtfsRealtimeBindings;

export function parseRealtime(buf: Uint8Array): RealtimeMap {
  const feed = rt.FeedMessage.decode(buf);
  const out: RealtimeMap = {};
  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    if (!tu?.trip?.tripId || !tu.trip.startDate) continue;
    const canceled = tu.trip.scheduleRelationship === rt.TripDescriptor.ScheduleRelationship.CANCELED;
    const sb = tu.stopTimeUpdate?.find(u => u.stopId === STONY_BROOK);
    // Departure delay when given, else arrival delay. Skipped stops count as canceled for us.
    const skipped = sb?.scheduleRelationship === rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;
    const delay = sb?.departure?.delay ?? sb?.arrival?.delay ?? null;
    if (!sb && !canceled) continue;
    out[`${tu.trip.tripId}|${tu.trip.startDate}`] = { canceled: canceled || skipped, delaySec: delay };
  }
  return out;
}

export async function fetchRealtime(): Promise<RealtimeMap> {
  const res = await fetch(FEED, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`LIRR realtime ${res.status}`);
  return parseRealtime(new Uint8Array(await res.arrayBuffer()));
}
