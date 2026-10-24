"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker, GeoJSONSource } from "maplibre-gl";
import { busElement, CAMPUS_CENTER, prefersDark, setBusHeading, type MapProps, type TripOverlay } from "@/lib/mapShared";
import type { BusRoute, BusStop } from "@/lib/types";

// Fallback renderer (no Google key, or Google failed to load). Free OpenFreeMap tiles.
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

function routesData(routes: BusRoute[]): FC {
  return fc(routes.map(r => ({
    type: "Feature",
    properties: { id: r.id, color: r.color },
    geometry: { type: "LineString", coordinates: r.shape },
  })));
}

function stopsData(stops: BusStop[]): FC {
  return fc(stops.map(s => ({
    type: "Feature",
    properties: { id: s.id, name: s.shortName || s.name },
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
  })));
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

export default function MapLibreView({ routes, stops, buses, overlay, userLocation, onStopClick, bottomPadding = 0 }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const userMarker = useRef<Marker | null>(null);
  const [styleReady, setStyleReady] = useState(0); // bumps on every style load
  const latest = useRef({ routes, stops, overlay, onStopClick });
  useEffect(() => {
    latest.current = { routes, stops, overlay, onStopClick };
  });

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
      map.addSource("routes", { type: "geojson", data: routesData(routes) });
      map.addSource("stops", { type: "geojson", data: stopsData(stops) });
      map.addSource("trip", { type: "geojson", data: overlayData(overlay) });
      map.addLayer({ id: "routes-casing", type: "line", source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1d150b", "line-width": 6, "line-opacity": 0.25 } });
      map.addLayer({ id: "routes", type: "line", source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": overlay ? 0.25 : 0.8 } });
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
    (mapRef.current?.getSource("routes") as GeoJSONSource | undefined)?.setData(routesData(routes));
  }, [routes, styleReady]);

  useEffect(() => {
    (mapRef.current?.getSource("stops") as GeoJSONSource | undefined)?.setData(stopsData(stops));
  }, [stops, styleReady]);

  // Keep the visible center above the bottom sheet.
  useEffect(() => {
    mapRef.current?.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: bottomPadding }, duration: 300 });
  }, [bottomPadding, styleReady]);

  // Trip overlay: draw and frame it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    (map.getSource("trip") as GeoJSONSource | undefined)?.setData(overlayData(overlay));
    if (map.getLayer("routes")) map.setPaintProperty("routes", "line-opacity", overlay ? 0.25 : 0.8);
    if (!overlay || !libRef.current) return;
    const pts = [...overlay.walk.flat(), ...overlay.bus.flatMap(b => b.coords)];
    if (pts.length < 2) return;
    const bounds = pts.reduce((b, p) => b.extend(p), new libRef.current.LngLatBounds(pts[0], pts[0]));
    // The sheet is already accounted for by the map's own padding (set below via easeTo).
    map.fitBounds(bounds, { padding: { top: 70, left: 40, right: 40, bottom: 40 }, maxZoom: 17.5, duration: 700 });
  }, [overlay, styleReady, bottomPadding]);

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
