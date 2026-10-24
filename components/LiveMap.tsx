"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import type { Bus } from "@/lib/etaspot";
import type { LatLng } from "@/lib/geo";
import type { Network } from "@/lib/network";
import type { Place } from "@/lib/places";
import type { TripOption } from "@/lib/planner";
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
  /** The trip option being shown: its boarding and alighting stops are highlighted. */
  trip: TripOption | null;
}

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };

function routesGeo(network: Network | null): FC {
  if (!network) return EMPTY;
  return {
    type: "FeatureCollection",
    features: network.routes
      .filter((r) => r.encLine)
      .map((r) => ({
        type: "Feature",
        properties: { color: r.color, id: r.id },
        geometry: { type: "LineString", coordinates: decodePolyline(r.encLine!) },
      })),
  };
}

function stopsGeo(network: Network | null): FC {
  if (!network) return EMPTY;
  return {
    type: "FeatureCollection",
    features: network.stops
      .filter((s) => s.routeIds.length > 0)
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

export default function LiveMap({ buses, network, selectedId, onSelect, destination, origin, trip }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const destMarker = useRef<Marker | null>(null);
  const originMarker = useRef<Marker | null>(null);
  // Latest overlay data, re-applied whenever the map style (re)loads.
  const overlay = useRef({ routes: EMPTY, stops: EMPTY, trip: EMPTY });
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

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
        m.addLayer({
          id: "route-lines",
          type: "line",
          source: "routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.5 },
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
      map.current.addControl(
        new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
        "top-right",
      );
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
  }, [ready, buses, selectedId, network]);

  // Fly to a bus when it is picked from the list.
  useEffect(() => {
    const bus = buses.find((b) => b.id === selectedId);
    if (bus && map.current) map.current.easeTo({ center: [bus.lng, bus.lat], zoom: 15.5, duration: 700 });
    // Only when the selection changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Keep the overlay layers in sync with the network and the trip being shown.
  useEffect(() => {
    overlay.current = { routes: routesGeo(network), stops: stopsGeo(network), trip: tripGeo(trip) };
    const m = map.current;
    if (!ready || !m) return;
    for (const [id, data] of Object.entries(overlay.current)) {
      (m.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    }
  }, [ready, network, trip]);

  // Where the trip starts: a navy dot with a white ring.
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre) return;
    if (!origin) {
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
  }, [ready, origin]);

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

  // Frame the whole trip once both ends are known.
  const originKey = origin ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : "";
  useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!ready || !m || !maplibre || !origin || !destination) return;
    const bounds = new maplibre.LngLatBounds([origin.lng, origin.lat], [origin.lng, origin.lat]);
    bounds.extend([destination.lng, destination.lat]);
    m.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: 700 });
    // Only when an end of the trip moves noticeably, not on every GPS update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, originKey, destination]);

  // MapLibre sets position: relative on its container, so the container fills a positioned wrapper.
  return (
    <div className="absolute inset-0" role="region" aria-label="Map of live buses">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
