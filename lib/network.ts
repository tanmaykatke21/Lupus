// Routes and stops as ETA Spot publishes them. Routes change between weekdays and weekends,
// so the server fetches them live and keeps a copy for 15 minutes.

export interface RawRoute {
  id: number;
  name: string;
  abbr: string;
  stops: number[];
  color: string;
  encLine?: string;
  type?: string;
}

export interface RawStop {
  rid: number;
  id: number;
  name: string;
  shortName?: string;
  lat: number;
  lng: number;
}

export interface Route {
  id: number;
  name: string;
  abbr: string;
  color: string;
  /** Stop ids in the order the bus visits them. Routes are loops, so the last stop leads back to the first. */
  stops: number[];
  encLine: string | null;
}

export interface Stop {
  id: number;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  /** Ids of the currently published routes that serve this stop. */
  routeIds: number[];
}

export interface Network {
  source: "live" | "saved";
  routes: Route[];
  stops: Stop[];
}

/** ETA Spot lists a stop once per route pattern; collapse those into one stop with the routes that serve it. */
export function buildNetwork(rawRoutes: RawRoute[], rawStops: RawStop[], source: Network["source"]): Network {
  const routes: Route[] = rawRoutes
    // Keep one-stop routes (e.g. Charter) for names and colors; the planner needs two stops to use one.
    .filter((r) => Array.isArray(r.stops) && r.stops.length > 0)
    .map((r) => ({
      id: r.id,
      name: r.name.trim(),
      abbr: (r.abbr ?? "").trim(),
      color: /^#[0-9a-f]{6}$/i.test(r.color ?? "") ? r.color : "#262840",
      stops: r.stops,
      encLine: r.encLine || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byId = new Map<number, Stop>();
  for (const s of rawStops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || byId.has(s.id)) continue;
    byId.set(s.id, {
      id: s.id,
      name: s.name.trim().replace(/\s+/g, " "),
      shortName: (s.shortName ?? "").trim(),
      lat: s.lat,
      lng: s.lng,
      routeIds: [],
    });
  }
  for (const r of routes) {
    for (const sid of new Set(r.stops)) byId.get(sid)?.routeIds.push(r.id);
  }
  return { source, routes, stops: [...byId.values()].sort((a, b) => a.id - b.id) };
}

export function routeById(network: Network, id: number): Route | undefined {
  return network.routes.find((r) => r.id === id);
}

export function stopById(network: Network, id: number): Stop | undefined {
  return network.stops.find((s) => s.id === id);
}
