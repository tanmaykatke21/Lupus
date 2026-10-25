"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import type { Bus } from "@/lib/etaspot";
import type { LatLng } from "@/lib/geo";
import type { Network } from "@/lib/network";
import type { Place } from "@/lib/places";
import { laneRoutes, type LanePiece } from "@/lib/lanes";
import type { NavSnapshot } from "@/lib/navEngine";
import type { TripOption, TripView } from "@/lib/planner";
import { decodePolyline } from "@/lib/polyline";
import { routeColor, routeLabel, textOn } from "@/lib/routes";

// Center of the main Stony Brook campus.
const CAMPUS: [number, number] = [-73.1234, 40.9124];
// Free vector tiles from OpenFreeMap; no API key needed.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
// If the tile server can't be reached, keep showing buses on a plain background instead of a broken map.
const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "background", type: "background" as const, paint: { "background-color": "#E3E2E9" } }],
};

interface Props {
  buses: Bus[];
  network: Network | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  destination: Place | null;
  origin: LatLng | null;
  /**
   * What the trip panel is showing. A bus option is drawn solid (its route, bus and stops) with the other
   * routes faded; a walk hides the bus layer and draws the walk instead.
   */
  view: TripView | null;
  /** Walking directions to draw, as [lng, lat] lines: the whole walk, or the walks to and from the bus. */
  walkLines: [number, number][][];
  /** Live navigation: the walker's spot and the route split into walked and still ahead. */
  nav: NavSnapshot | null;
  /** Changes with each navigation session, so following the walker restarts with it. */
  navId: string | null;
  /** Where the rider is right now (GPS), drawn as a live dot; null when unknown. */
  live: { position: LatLng; heading: number | null } | null;
  /** Draw the trip-start dot: only when the trip starts from a picked place rather than the rider's location. */
  showStart: boolean;
  /** Each position the map's locate button finds. */
  onLocate?: (fix: { position: LatLng; accuracyM: number; heading: number | null; at: number }) => void;
  /** The rider tapped the locate button: they want to start from where they are. */
  onLocateTap?: () => void;
  /** When planning a trip, only these routes (and their buses and stops) are drawn. Null shows everything. */
  focusRouteIds: number[] | null;
}

/** Opacity of route lines that aren't the one being ridden. */
const FADED = 0.45;

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };

/** Route lines for the routes being shown, split into side-by-side lanes where routes share a road. */
function routeLanes(network: Network | null, focus: number[] | null): LanePiece[] {
  if (!network) return [];
  return laneRoutes(
    network.routes
      .filter((r) => r.encLine && (!focus || focus.includes(r.id)))
      .map((r) => ({ id: r.id, coords: decodePolyline(r.encLine!) })),
  );
}

function routesGeo(network: Network | null, pieces: LanePiece[], solidRoute: number | null): FC {
  if (!network) return EMPTY;
  const colors = new Map(network.routes.map((r) => [r.id, r.color]));
  return {
    type: "FeatureCollection",
    features: pieces.map((p) => ({
      type: "Feature",
      properties: { color: colors.get(p.id) ?? "#262840", lane: p.lane, solid: p.id === solidRoute ? 1 : 0 },
      geometry: { type: "LineString", coordinates: p.coords },
    })),
  };
}

function walkGeo(lines: [number, number][][]): FC {
  return {
    type: "FeatureCollection",
    features: lines
      .filter((l) => l.length >= 2)
      .map((coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } })),
  };
}

function stopsGeo(network: Network | null, focus: number[] | null): FC {
  if (!network) return EMPTY;
  return {
    type: "FeatureCollection",
    features: network.stops
      .filter((s) => s.routeIds.length > 0 && (!focus || s.routeIds.some((id) => focus.includes(id))))
      .map((s) => ({ type: "Feature", properties: { name: s.name }, geometry: { type: "Point", coordinates: [s.lng, s.lat] } })),
  };
}

function tripGeo(trip: TripOption | null): FC {
  if (!trip) return EMPTY;
  const pt = (kind: string, s: { lat: number; lng: number; name: string }) => ({
    type: "Feature" as const,
    properties: { kind, name: s.name },
    geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
  });
  return { type: "FeatureCollection", features: [pt("board", trip.board.stop), pt("alight", trip.alight.stop)] };
}

export default function LiveMap({
  buses: allBuses,
  network,
  selectedId,
  onSelect,
  destination,
  origin,
  view,
  walkLines,
  nav,
  navId,
  live,
  showStart,
  onLocate,
  onLocateTap,
  focusRouteIds,
}: Props) {
  const focusKey = focusRouteIds ? focusRouteIds.join(",") : "all";
  const walking = view?.kind === "walk";
  const trip = view?.kind === "bus" ? view.option : null;
  // Only the buses on the routes being shown; none when the trip is a walk.
  const buses = useMemo(() => {
    if (walking) return [];
    const ids = focusKey === "all" ? null : new Set(focusKey.split(",").filter(Boolean).map(Number));
    return ids ? allBuses.filter((b) => ids.has(b.routeId)) : allBuses;
  }, [allBuses, focusKey, walking]);
  // Lanes only change with the routes shown, not every time the trip updates.
  const lanes = useMemo(
    () => routeLanes(network, focusKey === "all" ? null : focusKey.split(",").filter(Boolean).map(Number)),
    [network, focusKey],
  );
  const tripBusId = trip?.busId ?? null;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const destMarker = useRef<Marker | null>(null);
  const originMarker = useRef<Marker | null>(null);
  // Latest overlay data, re-applied whenever the map style (re)loads.
  const overlay = useRef({
    routes: EMPTY,
    stops: EMPTY,
    trip: EMPTY,
    walk: EMPTY,
    navWalked: EMPTY,
    navAhead: EMPTY,
    navLink: EMPTY,
  });
  const meMarker = useRef<Marker | null>(null);
  // The navigation session in which the rider dragged the map away; following stops until they recenter.
  const [detachedFrom, setDetachedFrom] = useState<string | null>(null);
  const following = navId !== null && detachedFrom !== navId;
  const navIdRef = useRef(navId);
  useEffect(() => {
    navIdRef.current = navId;
  }, [navId]);
  const onSelectRef = useRef(onSelect);
  const onLocateRef = useRef(onLocate);
  const onLocateTapRef = useRef(onLocateTap);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onLocateRef.current = onLocate;
    onLocateTapRef.current = onLocateTap;
  }, [onSelect, onLocate, onLocateTap]);

  // Create the map once, in the browser only.
  useEffect(() => {
    let cancelled = false;
    let removeResize = () => {};
    import("maplibre-gl").then((maplibre) => {
      if (cancelled || !container.current) return;
      lib.current = maplibre;
      // Copied into public/ by scripts/copy-maplibre-worker.mjs on install.
      maplibre.setWorkerUrl("/maplibre-gl-worker.mjs");
      map.current = new maplibre.Map({
        container: container.current,
        style: STYLE_URL,
        center: CAMPUS,
        zoom: 14,
        attributionControl: { compact: true },
      });
      // Route lines, stop dots and trip highlights are map layers; a style change wipes them, so add them on every load.
      map.current.on("style.load", () => {
        const m = map.current;
        if (!m) return;
        const data = overlay.current;
        m.addSource("routes", { type: "geojson", data: data.routes });
        m.addSource("stops", { type: "geojson", data: data.stops });
        m.addSource("trip", { type: "geojson", data: data.trip });
        m.addSource("walk", { type: "geojson", data: data.walk });
        m.addSource("navWalked", { type: "geojson", data: data.navWalked });
        m.addSource("navAhead", { type: "geojson", data: data.navAhead });
        m.addSource("navLink", { type: "geojson", data: data.navLink });
        // Each route keeps its own lane where routes share a road: the offset is in line widths, so lanes
        // stay side by side at every zoom. The route being ridden is solid and drawn on top.
        m.addLayer({
          id: "route-lines",
          type: "line",
          source: "routes",
          layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "solid"] },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 15, 4.5, 18, 8],
            "line-offset": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
              ["*", ["get", "lane"], 3.2],
              15,
              ["*", ["get", "lane"], 5.6],
              18,
              ["*", ["get", "lane"], 9.5],
            ],
            "line-opacity": ["case", ["==", ["get", "solid"], 1], 1, FADED],
          },
        });
        // Walking directions: navy dots on a soft white band so they read over streets and buildings.
        m.addLayer({
          id: "walk-casing",
          type: "line",
          source: "walk",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#FFFFFF", "line-width": 8, "line-opacity": 0.85 },
        });
        m.addLayer({
          id: "walk-line",
          type: "line",
          source: "walk",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#262840", "line-width": 4.5, "line-dasharray": [0.1, 1.8] },
        });
        // Live navigation: the stretch already walked fades to grey; the way ahead is a solid navy line.
        m.addLayer({
          id: "nav-walked",
          type: "line",
          source: "navWalked",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#8E8B9B", "line-width": 5, "line-opacity": 0.7 },
        });
        m.addLayer({
          id: "nav-ahead-casing",
          type: "line",
          source: "navAhead",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#FFFFFF", "line-width": 10 },
        });
        m.addLayer({
          id: "nav-ahead",
          type: "line",
          source: "navAhead",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#262840", "line-width": 6 },
        });
        // Off the path: a thin red dotted line from the walker back to the nearest point on it.
        m.addLayer({
          id: "nav-link",
          type: "line",
          source: "navLink",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#E8264F", "line-width": 3, "line-dasharray": [0.1, 2] },
        });
        m.addLayer({
          id: "stop-dots",
          type: "circle",
          source: "stops",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 16, 5],
            "circle-color": "#FFFFFF",
            "circle-stroke-color": "#262840",
            "circle-stroke-width": 1.5,
          },
        });
        m.addLayer({
          id: "trip-stops",
          type: "circle",
          source: "trip",
          paint: {
            "circle-radius": 9,
            "circle-color": ["match", ["get", "kind"], "board", "#262840", "#E8264F"],
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 3,
          },
        });
      });
      let fellBack = false;
      map.current.on("error", (e) => {
        const msg = String(e?.error?.message ?? "");
        if (!fellBack && !map.current?.isStyleLoaded() && /fetch|style|Failed/i.test(msg)) {
          fellBack = true;
          map.current?.setStyle(FALLBACK_STYLE);
        }
      });
      map.current.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      // The locate button asks for location and centers the map; Lupus draws the dot itself (one dot for the
      // map, the trip and navigation), so the control's own dot is off.
      const locate = new maplibre.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
        trackUserLocation: true,
        showUserLocation: false,
        showAccuracyCircle: false,
      });
      locate.on("geolocate", (e) =>
        onLocateRef.current?.({
          position: { lat: e.coords.latitude, lng: e.coords.longitude },
          accuracyM: e.coords.accuracy,
          heading: Number.isFinite(e.coords.heading) && (e.coords.speed ?? 0) > 0.3 ? e.coords.heading : null,
          at: e.timestamp || Date.now(),
        }),
      );
      locate.on("trackuserlocationstart", () => onLocateTapRef.current?.());
      map.current.addControl(locate, "top-right");
      // Keep the campus centered in the part of the map not covered by the bus list.
      const pad = () => {
        const wide = window.innerWidth >= 768;
        map.current?.setPadding(wide ? { left: 400, top: 0, right: 0, bottom: 0 } : { left: 0, top: 60, right: 0, bottom: Math.round(window.innerHeight * 0.52) });
      };
      pad();
      map.current.jumpTo({ center: CAMPUS });
      window.addEventListener("resize", pad);
      removeResize = () => window.removeEventListener("resize", pad);
      setReady(true);
    });
    const owned = markers.current;
    return () => {
      cancelled = true;
      removeResize();
      owned.forEach((m) => m.remove());
      owned.clear();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /**
   * Buses that overlap on screen (two buses at SAC) would hide one another, so lay each overlapping group
   * out in a row, using the markers' real widths. Overlap depends on zoom, so this reruns after zooming.
   */
  const layoutMarkers = () => {
    const m = map.current;
    if (!m) return;
    const GAP = 4;
    const items = [...markers.current.values()].map((mk) => {
      const p = m.project(mk.getLngLat());
      const w = (mk.getElement().firstElementChild as HTMLElement | null)?.offsetWidth || 34;
      return { mk, x: p.x, y: p.y, w };
    });
    items.sort((a, b) => a.x - b.x);
    const groups: (typeof items)[] = [];
    for (const it of items) {
      const g = groups.find((grp) => grp.some((o) => Math.abs(o.x - it.x) < (o.w + it.w) / 2 + GAP && Math.abs(o.y - it.y) < 34));
      if (g) g.push(it);
      else groups.push([it]);
    }
    for (const g of groups) {
      const cx = g.reduce((a, it) => a + it.x, 0) / g.length;
      const total = g.reduce((a, it) => a + it.w, 0) + GAP * (g.length - 1);
      let x = cx - total / 2;
      for (const it of g) {
        // Offset from the marker's own position to its slot in the row.
        it.mk.setOffset(g.length > 1 ? [x + it.w / 2 - it.x, 0] : [0, 0]);
        x += it.w + GAP;
      }
    }
  };
  const layoutRef = useRef(layoutMarkers);
  useEffect(() => {
    layoutRef.current = layoutMarkers;
  });
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const onZoom = () => layoutRef.current();
    // Dragging the map while navigating means the rider wants to look around: stop following them.
    const onDrag = () => {
      if (navIdRef.current) setDetachedFrom(navIdRef.current);
    };
    m.on("zoomend", onZoom);
    m.on("dragstart", onDrag);
    return () => {
      m.off("zoomend", onZoom);
      m.off("dragstart", onDrag);
    };
  }, [ready]);

  // Add, move and remove bus markers whenever the feed changes.
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    const seen = new Set<string>();

    for (const bus of buses) {
      seen.add(bus.id);
      let marker = markers.current.get(bus.id);
      if (!marker) {
        // MapLibre positions the outer element with a transform; all styling lives on the inner button.
        const el = document.createElement("div");
        el.innerHTML = `<button type="button" class="bus-marker"><span class="heading"></span><span class="label"></span></button>`;
        el.firstElementChild!.addEventListener("click", () => onSelectRef.current(bus.id));
        marker = new maplibre.Marker({ element: el }).setLngLat([bus.lng, bus.lat]).addTo(m);
        markers.current.set(bus.id, marker);
      }
      marker.setLngLat([bus.lng, bus.lat]);
      const el = marker.getElement().firstElementChild as HTMLElement;
      const color = routeColor(bus.routeId, network);
      el.style.background = color;
      el.style.color = textOn(color);
      el.dataset.soon = String(bus.minutesToNextStop !== null && bus.minutesToNextStop < 2);
      el.dataset.selected = String(bus.id === selectedId);
      // While a bus trip is shown, every other bus steps back.
      el.dataset.faded = String(tripBusId !== null && bus.id !== tripBusId);
      el.setAttribute("aria-label", `Bus ${bus.id} on route ${bus.routeId}`);
      (el.querySelector(".label") as HTMLElement).textContent = routeLabel(bus.routeId, network);
      (el.querySelector(".heading") as HTMLElement).style.transform = `rotate(${bus.heading}deg)`;
    }

    // On the first data, frame the buses that are on or near campus (route 25-style trips far off campus are skipped).
    if (!fitted.current && buses.length > 0) {
      const near = buses.filter((b) => Math.abs(b.lat - CAMPUS[1]) < 0.03 && Math.abs(b.lng - CAMPUS[0]) < 0.04);
      if (near.length >= 2) {
        const bounds = new maplibre.LngLatBounds();
        near.forEach((b) => bounds.extend([b.lng, b.lat]));
        m.fitBounds(bounds, { padding: 48, maxZoom: 15.5, duration: 0 });
      }
      fitted.current = true;
    }

    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    layoutMarkers();
  }, [ready, buses, selectedId, network, tripBusId]);

  // Fly to a bus when it is picked from the list.
  useEffect(() => {
    const bus = buses.find((b) => b.id === selectedId);
    if (bus && map.current) map.current.easeTo({ center: [bus.lng, bus.lat], zoom: 15.5, duration: 700 });
    // Only when the selection changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Keep the overlay layers in sync with the network and the trip being shown.
  useEffect(() => {
    const focus = focusKey === "all" ? null : focusKey.split(",").filter(Boolean).map(Number);
    const layers = walking
      ? { routes: EMPTY, stops: EMPTY, trip: EMPTY, walk: walkGeo(walkLines) }
      : {
          routes: routesGeo(network, lanes, trip?.routeId ?? null),
          stops: stopsGeo(network, focus),
          trip: tripGeo(trip),
          walk: walkGeo(walkLines),
        };
    overlay.current = { ...overlay.current, ...layers };
    const m = map.current;
    if (!ready || !m) return;
    for (const [id, data] of Object.entries(layers)) {
      (m.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    }
  }, [ready, network, trip, focusKey, lanes, walking, walkLines]);

  // Live navigation lines.
  const navWalked = nav?.walked;
  const navAhead = nav?.ahead;
  const navLink = nav?.backToPath ?? undefined;
  useEffect(() => {
    const line = (coords: [number, number][] | undefined): FC => walkGeo(coords && coords.length >= 2 ? [coords] : []);
    overlay.current = { ...overlay.current, navWalked: line(navWalked), navAhead: line(navAhead), navLink: line(navLink) };
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("navWalked") as GeoJSONSource | undefined)?.setData(overlay.current.navWalked);
    (m.getSource("navAhead") as GeoJSONSource | undefined)?.setData(overlay.current.navAhead);
    (m.getSource("navLink") as GeoJSONSource | undefined)?.setData(overlay.current.navLink);
  }, [ready, navWalked, navAhead, navLink]);

  // You are here: a navy dot with an arrow for the way you're going. While navigating it sits on the path and
  // the map follows it; otherwise it's the live GPS position.
  const me: [number, number] | null = nav?.me ?? (live ? [live.position.lng, live.position.lat] : null);
  const meKey = me ? `${me[0].toFixed(7)},${me[1].toFixed(7)}` : "";
  const bearing = nav ? nav.bearing : (live?.heading ?? null);
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div class="nav-puck" role="img" aria-label="You are here"><span class="nav-heading"></span><span class="nav-dot"></span></div>`;
      meMarker.current = new maplibre.Marker({ element: el }).setLngLat(me).addTo(m);
    } else {
      meMarker.current.setLngLat(me);
    }
    const heading = meMarker.current.getElement().querySelector(".nav-heading") as HTMLElement;
    heading.style.display = bearing === null ? "none" : "";
    if (bearing !== null) heading.style.transform = `rotate(${bearing}deg)`;
    if (following) m.easeTo({ center: me, zoom: Math.max(m.getZoom(), 17), duration: 900 });
    // Keyed on the rounded position, not the array, so equal fixes don't re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, meKey, bearing, following]);

  // Where the trip starts: a navy dot with a white ring.
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    if (!origin || !showStart) {
      originMarker.current?.remove();
      originMarker.current = null;
      return;
    }
    if (!originMarker.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div class="origin-dot" role="img" aria-label="Trip start"></div>`;
      originMarker.current = new maplibre.Marker({ element: el }).setLngLat([origin.lng, origin.lat]).addTo(m);
    } else {
      originMarker.current.setLngLat([origin.lng, origin.lat]);
    }
  }, [ready, origin, showStart]);

  // Pin the chosen destination and bring it into view.
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    destMarker.current?.remove();
    destMarker.current = null;
    if (!destination) return;
    const el = document.createElement("div");
    el.innerHTML = `<div class="dest-pin" role="img" aria-label="Destination: ${destination.name.replace(/"/g, "")}"><span></span></div>`;
    destMarker.current = new maplibre.Marker({ element: el, anchor: "bottom" })
      .setLngLat([destination.lng, destination.lat])
      .addTo(m);
    m.easeTo({ center: [destination.lng, destination.lat], zoom: Math.max(m.getZoom(), 15.5), duration: 700 });
  }, [ready, destination]);

  // Frame the whole trip once both ends are known, and again only if the start jumps somewhere else (a new
  // start picked), not while the rider walks: re-framing on every step would make their dot look stuck.
  const framed = useRef<{ dest: string; lat: number; lng: number } | null>(null);
  const originKey = origin ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : "";
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre || !origin || !destination || nav) return;
    const last = framed.current;
    const moved = last ? Math.hypot((origin.lat - last.lat) * 110_540, (origin.lng - last.lng) * 84_000) : Infinity;
    if (last && last.dest === destination.id && moved < 300) return;
    framed.current = { dest: destination.id, lat: origin.lat, lng: origin.lng };
    const bounds = new maplibre.LngLatBounds([origin.lng, origin.lat], [origin.lng, origin.lat]);
    bounds.extend([destination.lng, destination.lat]);
    m.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, originKey, destination]);

  // MapLibre sets position: relative on its container, so the container fills a positioned wrapper.
  return (
    <div className="absolute inset-0" role="region" aria-label="Map of live buses">
      <div ref={container} className="h-full w-full" />
      {navId && !following && me && (
        <button
          type="button"
          onClick={() => setDetachedFrom(null)}
          className="absolute right-3 top-28 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_rgb(38_40_64/0.3)] max-md:bottom-[calc(48dvh+12px)] max-md:top-auto"
        >
          Recenter
        </button>
      )}
    </div>
  );
}
