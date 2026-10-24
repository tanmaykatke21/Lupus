"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import type { Bus } from "@/lib/etaspot";
import type { Place } from "@/lib/places";
import { routeColor } from "@/lib/routes";

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
  selectedId: string | null;
  onSelect: (id: string) => void;
  destination: Place | null;
}

export default function LiveMap({ buses, selectedId, onSelect, destination }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const destMarker = useRef<Marker | null>(null);
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
      el.style.background = routeColor(bus.routeId);
      el.dataset.soon = String(bus.minutesToNextStop !== null && bus.minutesToNextStop < 2);
      el.dataset.selected = String(bus.id === selectedId);
      el.setAttribute("aria-label", `Bus ${bus.id} on route ${bus.routeId}`);
      (el.querySelector(".label") as HTMLElement).textContent = String(bus.routeId);
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
  }, [ready, buses, selectedId]);

  // Fly to a bus when it is picked from the list.
  useEffect(() => {
    const bus = buses.find((b) => b.id === selectedId);
    if (bus && map.current) map.current.easeTo({ center: [bus.lng, bus.lat], zoom: 15.5, duration: 700 });
    // Only when the selection changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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

  // MapLibre sets position: relative on its container, so the container fills a positioned wrapper.
  return (
    <div className="absolute inset-0" role="region" aria-label="Map of live buses">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
