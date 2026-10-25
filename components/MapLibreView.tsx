"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, Marker, GeoJSONSource } from "maplibre-gl";
import { turn } from "@/lib/compass";
import { busElement, CAMPUS_CENTER, FOLLOW_MIN_TURN, FOLLOW_TILT, FOLLOW_ZOOM, prefersDark, setBusHeading, type MapProps, type TripOverlay } from "@/lib/mapShared";
import { drawLane, laneUnitPx, metersPerPixel } from "@/lib/laneOffset";
import { directionalLanes, type LaneLine } from "@/lib/directionalLanes";
import type { BusRoute, BusStop } from "@/lib/types";

// Fallback renderer (no Google key, or Google failed to load). Free OpenFreeMap tiles.
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

// Routes are drawn in keep-right lanes by direction (lib/directionalLanes.ts). Each route is one
// continuous line, offset point by point in meters for the current zoom (recomputed when the zoom
// settles) and untangled where a tight curve would fold it.
function routesData(routes: BusRoute[], lines: LaneLine[], zoom: number): FC {
  const color = new Map(routes.map(r => [r.id, r.color]));
  const m = laneUnitPx(zoom) * metersPerPixel(CAMPUS_CENTER[1], zoom);
  return fc(lines.map(l => ({
    type: "Feature",
    properties: { id: l.id, color: color.get(l.id) },
    geometry: { type: "LineString", coordinates: drawLane(l.coords, l.lanes, m) },
  })));
}

function stopsData(stops: BusStop[]): FC {
  return fc(stops.map(s => ({
    type: "Feature",
    properties: { id: s.id, name: s.shortName || s.name },
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
  })));
}

function altData(o: TripOverlay | null | undefined): FC {
  return fc((o?.alternatives ?? []).flatMap(a => [
    ...a.walk.filter(l => l.length > 1).map(coords => ({
      type: "Feature" as const, properties: { kind: "walk", color: "#000" }, geometry: { type: "LineString" as const, coordinates: coords },
    })),
    ...a.bus.map(b => ({
      type: "Feature" as const, properties: { kind: "bus", color: b.color }, geometry: { type: "LineString" as const, coordinates: b.coords },
    })),
  ]));
}

function overlayData(o: TripOverlay | null | undefined): FC {
  if (!o) return fc([]);
  return fc([
    ...o.walk.filter(l => l.length > 1).map(coords => ({
      type: "Feature" as const, properties: { kind: "walk", color: "#000" },
      geometry: { type: "LineString" as const, coordinates: coords },
    })),
    ...o.bus.map(b => ({
      type: "Feature" as const, properties: { kind: "bus", color: b.color },
      geometry: { type: "LineString" as const, coordinates: b.coords },
    })),
    ...(o.from ? [{ type: "Feature" as const, properties: { kind: "from" }, geometry: { type: "Point" as const, coordinates: o.from } }] : []),
    ...(o.to ? [{ type: "Feature" as const, properties: { kind: "to" }, geometry: { type: "Point" as const, coordinates: o.to } }] : []),
  ]);
}

export default function MapLibreView({ routes, stops, buses, overlay, userLocation, onStopClick, bottomPadding = 0, fitKey, follow, onUserPan }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const userMarker = useRef<Marker | null>(null);
  const [styleReady, setStyleReady] = useState(0); // bumps on every style load
  const lines = useMemo(() => directionalLanes(routes.map(r => ({ id: r.id, coords: r.shape }))), [routes]);
  const latest = useRef({ routes, lines, stops, overlay, onStopClick, onUserPan });
  useEffect(() => {
    latest.current = { routes, lines, stops, overlay, onStopClick, onUserPan };
  });
  const lastCamera = useRef<{ heading: number; lng: number; lat: number } | null>(null);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let mq: MediaQueryList | null = null;
    let onScheme: (() => void) | null = null;
    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      lib.setWorkerUrl("/maplibre-gl-worker.mjs");
      libRef.current = lib;
      const map = new lib.Map({
        container: container.current,
        style: prefersDark() ? STYLE_DARK : STYLE_LIGHT,
        center: CAMPUS_CENTER,
        zoom: 14.6,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new lib.NavigationControl({ showCompass: true }), "top-right");
      map.on("style.load", () => setStyleReady(n => n + 1));
      map.on("click", "stops", e => {
        const id = e.features?.[0]?.properties?.id;
        const stop = latest.current.stops.find(s => s.id === id);
        if (stop) latest.current.onStopClick?.(stop);
      });
      // Lane offsets are in meters for a zoom level: recompute them when the zoom settles.
      map.on("zoomend", () => {
        const { routes, lines } = latest.current;
        (map.getSource("routes") as GeoJSONSource | undefined)?.setData(routesData(routes, lines, map.getZoom()));
      });
      // A drag by the user (not our own camera moves) pauses follow mode.
      map.on("dragstart", e => { if (e.originalEvent) latest.current.onUserPan?.(); });
      map.on("mouseenter", "stops", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "stops", () => (map.getCanvas().style.cursor = ""));

      mq = window.matchMedia("(prefers-color-scheme: dark)");
      onScheme = () => map.setStyle(mq!.matches ? STYLE_DARK : STYLE_LIGHT);
      mq.addEventListener("change", onScheme);
    })();
    const markerMap = markers.current;
    return () => {
      cancelled = true;
      if (mq && onScheme) mq.removeEventListener("change", onScheme);
      markerMap.forEach(m => m.remove());
      markerMap.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // (Re)install our sources and layers whenever a style finishes loading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const { routes, stops, overlay } = latest.current;
    if (!map.getSource("routes")) {
      map.addSource("routes", { type: "geojson", data: routesData(routes, latest.current.lines, map.getZoom()) });
      map.addSource("stops", { type: "geojson", data: stopsData(stops) });
      map.addSource("trip", { type: "geojson", data: overlayData(overlay) });
      map.addSource("alts", { type: "geojson", data: altData(overlay) });
      map.addLayer({ id: "routes-casing", type: "line", source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1d150b", "line-width": 6, "line-opacity": 0.25 } });
      map.addLayer({ id: "routes", type: "line", source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": overlay ? 0.25 : 0.8 } });
      // Other possible routes, faded, under the chosen one.
      map.addLayer({ id: "alt-bus", type: "line", source: "alts", filter: ["==", ["get", "kind"], "bus"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.4 } });
      map.addLayer({ id: "alt-walk", type: "line", source: "alts", filter: ["==", ["get", "kind"], "walk"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": prefersDark() ? "#f0c46a" : "#3a3631", "line-width": 3, "line-opacity": 0.45, "line-dasharray": [0.5, 2] } });
      map.addLayer({ id: "trip-walk", type: "line", source: "trip", filter: ["==", ["get", "kind"], "walk"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": prefersDark() ? "#f0c46a" : "#3a3631", "line-width": 4, "line-dasharray": [0.6, 1.6] } });
      map.addLayer({ id: "trip-bus-casing", type: "line", source: "trip", filter: ["==", ["get", "kind"], "bus"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#f0c46a", "line-width": 10 } });
      map.addLayer({ id: "trip-bus", type: "line", source: "trip", filter: ["==", ["get", "kind"], "bus"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 6 } });
      map.addLayer({ id: "stops", type: "circle", source: "stops",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 17, 6],
          "circle-color": "#fbf6ea", "circle-stroke-color": "#a8781f", "circle-stroke-width": 2 } });
      map.addLayer({ id: "stop-labels", type: "symbol", source: "stops", minzoom: 16,
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top",
          "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": prefersDark() ? "#f1e6d0" : "#2a2118",
          "text-halo-color": prefersDark() ? "#14110e" : "#fbf6ea", "text-halo-width": 1.5 } });
      map.addLayer({ id: "trip-ends", type: "circle", source: "trip", filter: ["in", ["get", "kind"], ["literal", ["from", "to"]]],
        paint: { "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": "#fff",
          "circle-color": ["match", ["get", "kind"], "from", "#3a3631", "#c8283e"] } });
    }
  }, [styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    (map?.getSource("routes") as GeoJSONSource | undefined)?.setData(routesData(routes, lines, map!.getZoom()));
  }, [routes, lines, styleReady]);

  useEffect(() => {
    (mapRef.current?.getSource("stops") as GeoJSONSource | undefined)?.setData(stopsData(stops));
  }, [stops, styleReady]);

  // Keep the visible center above the bottom sheet.
  useEffect(() => {
    mapRef.current?.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: bottomPadding }, duration: 300 });
  }, [bottomPadding, styleReady]);

  // Trip overlay: redraw on every refresh…
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    (map.getSource("trip") as GeoJSONSource | undefined)?.setData(overlayData(overlay));
    (map.getSource("alts") as GeoJSONSource | undefined)?.setData(altData(overlay));
    if (map.getLayer("routes")) map.setPaintProperty("routes", "line-opacity", overlay ? 0.25 : 0.8);
  }, [overlay, styleReady]);

  // …but frame it only when the trip itself changes, so the user's own zoom is never undone.
  const following = !!follow?.on;
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current, trip = latest.current.overlay;
    if (!map || !lib || !styleReady || !trip || !fitKey || following) return;
    const pts = [...trip.walk.flat(), ...trip.bus.flatMap(b => b.coords)];
    if (pts.length < 2) return;
    const bounds = pts.reduce((b, p) => b.extend(p), new lib.LngLatBounds(pts[0], pts[0]));
    // The sheet is already accounted for by the map's own padding.
    map.fitBounds(bounds, { padding: { top: 70, left: 40, right: 40, bottom: 40 }, maxZoom: 17.5, bearing: 0, pitch: 0, duration: 700 });
  }, [fitKey, styleReady, following]);

  // Follow mode: keep the user centered, heading up, tilted, like turn-by-turn navigation.
  const heading = follow?.heading ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (!following || !userLocation) {
      if (lastCamera.current) map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
      lastCamera.current = null;
      return;
    }
    const prev = lastCamera.current;
    const h = heading ?? prev?.heading ?? 0;
    const moved = !prev || Math.abs(prev.lng - userLocation[0]) > 1e-5 || Math.abs(prev.lat - userLocation[1]) > 1e-5;
    if (prev && !moved && Math.abs(turn(prev.heading, h)) < FOLLOW_MIN_TURN) return;
    lastCamera.current = { heading: h, lng: userLocation[0], lat: userLocation[1] };
    // Map padding already keeps the sheet clear; nudge the user lower in the visible area, looking ahead.
    const visibleH = map.getContainer().clientHeight - bottomPadding;
    map.easeTo({
      center: userLocation, bearing: h, pitch: FOLLOW_TILT, offset: [0, visibleH * 0.2],
      zoom: prev ? map.getZoom() : Math.max(map.getZoom(), FOLLOW_ZOOM), // keep the user's zoom once following
      duration: prev ? 350 : 800,
    });
    // bottomPadding is read for the offset only; sheet drags shouldn't re-run the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, heading, userLocation, styleReady]);

  // Live bus markers, keyed by vehicle id so they glide instead of blinking.
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib) return;
    const seen = new Set<string>();
    for (const bus of buses) {
      const route = routes.find(r => r.id === bus.routeId);
      seen.add(bus.id);
      let marker = markers.current.get(bus.id);
      if (!marker) {
        const el = busElement(route?.color ?? "#a8781f", route?.abbr ?? "Bus");
        el.setAttribute("aria-label", `${route?.name ?? "Bus"} bus ${bus.id}`);
        marker = new lib.Marker({ element: el }).setLngLat([bus.lng, bus.lat]).addTo(map);
        markers.current.set(bus.id, marker);
      } else {
        marker.setLngLat([bus.lng, bus.lat]);
      }
      setBusHeading(marker.getElement(), bus.heading);
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) { m.remove(); markers.current.delete(id); }
    }
  }, [buses, routes, styleReady]);

  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib) return;
    userMarker.current?.remove();
    userMarker.current = null;
    if (!userLocation) return;
    const el = document.createElement("div");
    el.className = "h-4 w-4 rounded-full border-[3px] border-white bg-sky-500 shadow-[0_0_0_6px_rgba(14,165,233,0.25)]";
    el.setAttribute("aria-label", "Your location");
    userMarker.current = new lib.Marker({ element: el }).setLngLat(userLocation).addTo(map);
  }, [userLocation, styleReady]);

  // MapLibre's CSS forces position: relative on the container, so the sizing lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="map-warm h-full w-full" aria-label="Campus map" role="region" />
    </div>
  );
}
