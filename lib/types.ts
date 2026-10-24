// Normalized shapes shared by API routes, the router and the UI.

export type LngLat = [number, number];

export interface BusRoute {
  id: number;
  name: string;
  abbr: string;
  color: string;
  stopIds: number[]; // in travel order
  shape: LngLat[];
}

export interface BusStop {
  id: number;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  routeIds: number[];
}

export interface Bus {
  id: string;
  routeId: number;
  lat: number;
  lng: number;
  heading: number;
  nextStopId: number | null;
  inService: boolean;
  load: number | null; // 0..1
  receivedAt: number; // epoch ms
}

export interface StopEta {
  stopId: number;
  routeId: number;
  tripKey: string; // ETA Spot scheduleNumber; same trip across stops
  busId: string | null; // null = scheduled trip with no bus assigned yet
  minutes: number;
  arrivesAt: number; // epoch ms
  scheduled: string;
  direction: string;
}

export interface BusesResponse {
  buses: Bus[];
  source: "live" | "replay";
  fetchedAt: number;
}
