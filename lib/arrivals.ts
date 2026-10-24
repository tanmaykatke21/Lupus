// Turns a stream of bus positions into "bus N reached stop S at time T" events.
import { meters } from "./geo";
import type { Bus, BusStop } from "./types";

export const ARRIVAL_RADIUS_M = 30;
// A bus idling at a stop keeps matching; only count it again after it has left for this long.
const REARM_MS = 3 * 60_000;

export interface Arrival {
  time: number;
  vehicleId: string;
  routeId: number;
  stopId: number;
  distanceM: number;
}

export class ArrivalDetector {
  private lastSeen = new Map<string, number>(); // `${vehicle}:${stop}` -> last time within radius

  constructor(private stops: BusStop[]) {}

  setStops(stops: BusStop[]) {
    this.stops = stops;
  }

  observe(bus: Bus): Arrival[] {
    if (!bus.inService) return [];
    const out: Arrival[] = [];
    for (const stop of this.stops) {
      if (!stop.routeIds.includes(bus.routeId)) continue;
      const d = meters([bus.lng, bus.lat], [stop.lng, stop.lat]);
      if (d > ARRIVAL_RADIUS_M) continue;
      const key = `${bus.id}:${stop.id}`;
      const prev = this.lastSeen.get(key);
      this.lastSeen.set(key, bus.receivedAt);
      if (prev === undefined || bus.receivedAt - prev > REARM_MS) {
        out.push({ time: bus.receivedAt, vehicleId: bus.id, routeId: bus.routeId, stopId: stop.id, distanceM: d });
      }
    }
    return out;
  }
}
