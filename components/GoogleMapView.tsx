"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef, useState } from "react";
import { busElement, CAMPUS_CENTER, prefersDark, setBusHeading, type MapProps } from "@/lib/mapShared";
import type { LngLat } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
// Advanced markers need a map id. DEMO_MAP_ID works for development; create your own in
// Cloud Console (Map Management) to style the map and use it in production.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

let configured = false;
// Google's documented way to remove an advanced marker.
const detach = (m: google.maps.marker.AdvancedMarkerElement) => { m.map = null; };
const toLatLng = ([lng, lat]: LngLat) => ({ lat, lng });

interface Libs {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  core: google.maps.CoreLibrary;
}

function dot(fill: string, stroke: string, size: number, className = "") {
  const el = document.createElement("div");
  el.className = className;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:3px solid ${stroke};box-shadow:0 1px 3px rgba(0,0,0,.35);transform:translateY(50%)`;
  return el;
}

export default function GoogleMapView({ routes, stops, buses, overlay, userLocation, onStopClick, bottomPadding = 0, onError }: MapProps & { onError: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const libsRef = useRef<Libs | null>(null);
  const [ready, setReady] = useState(false);
  const routeLines = useRef<google.maps.Polyline[]>([]);
  const stopMarkers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const tripShapes = useRef<(google.maps.Polyline | google.maps.marker.AdvancedMarkerElement)[]>([]);
  const busMarkers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const userMarker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const lastPadding = useRef(bottomPadding);
  const onStopRef = useRef(onStopClick);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStopRef.current = onStopClick;
    onErrorRef.current = onError;
  });

  // Load the API and create the map once.
  useEffect(() => {
    let cancelled = false;
    // Google calls this global on an invalid key, missing billing or a blocked referrer.
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure = () => onErrorRef.current();
    (async () => {
      try {
        if (!configured) {
          setOptions({ key: KEY, v: "weekly" });
          configured = true;
        }
        const [maps, marker, core] = await Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("core")]);
        if (cancelled || !container.current) return;
        libsRef.current = { maps, marker, core };
        mapRef.current = new maps.Map(container.current, {
          center: toLatLng(CAMPUS_CENTER),
          zoom: 15,
          mapId: MAP_ID,
          colorScheme: "FOLLOW_SYSTEM",
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        setReady(true);
      } catch (err) {
        console.error("[map] Google Maps failed to load", err);
        if (!cancelled) onErrorRef.current();
      }
    })();
    const buses = busMarkers.current;
    return () => {
      cancelled = true;
      // Detach everything so Google's script never touches unmounted elements.
      buses.forEach(detach);
      buses.clear();
      stopMarkers.current.forEach(detach);
      routeLines.current.forEach(l => l.setMap(null));
      tripShapes.current.forEach(s => ("setMap" in s ? s.setMap(null) : detach(s)));
      if (userMarker.current) detach(userMarker.current);
      mapRef.current = null;
    };
  }, []);

  // Route lines.
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    routeLines.current.forEach(l => l.setMap(null));
    routeLines.current = routes.map(r => new libs.maps.Polyline({
      map, path: r.shape.map(toLatLng), strokeColor: r.color, strokeOpacity: 0.8, strokeWeight: 4, zIndex: 1, clickable: false,
    }));
  }, [routes, ready]);

  // Dim the network while a trip is shown.
  useEffect(() => {
    routeLines.current.forEach(l => l.setOptions({ strokeOpacity: overlay ? 0.25 : 0.8 }));
  }, [overlay, routes, ready]);

  // Stops.
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    stopMarkers.current.forEach(detach);
    stopMarkers.current = stops.map(s => {
      const m = new libs.marker.AdvancedMarkerElement({
        map, position: { lat: s.lat, lng: s.lng }, title: s.name, zIndex: 2,
        content: dot("#fbf6ea", "#a8781f", 12),
        gmpClickable: true,
      });
      m.addEventListener("gmp-click", () => onStopRef.current?.(s));
      return m;
    });
  }, [stops, ready]);

  // Trip overlay: draw it and frame it above the bottom sheet.
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    tripShapes.current.forEach(s => (s instanceof libs.maps.Polyline ? s.setMap(null) : detach(s)));
    tripShapes.current = [];
    if (!overlay) return;
    const walkColor = prefersDark() ? "#f0c46a" : "#3a3631";
    for (const line of overlay.walk) {
      if (line.length < 2) continue;
      tripShapes.current.push(new libs.maps.Polyline({
        map, path: line.map(toLatLng), strokeOpacity: 0, zIndex: 5, clickable: false,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: walkColor, scale: 3 }, offset: "0", repeat: "10px" }],
      }));
    }
    for (const b of overlay.bus) {
      tripShapes.current.push(new libs.maps.Polyline({ map, path: b.coords.map(toLatLng), strokeColor: "#f0c46a", strokeWeight: 10, zIndex: 3, clickable: false }));
      tripShapes.current.push(new libs.maps.Polyline({ map, path: b.coords.map(toLatLng), strokeColor: b.color, strokeWeight: 6, zIndex: 4, clickable: false }));
    }
    if (overlay.from) {
      tripShapes.current.push(new libs.marker.AdvancedMarkerElement({ map, position: toLatLng(overlay.from), zIndex: 6, content: dot("#3a3631", "#fff", 18) }));
    }
    if (overlay.to) {
      tripShapes.current.push(new libs.marker.AdvancedMarkerElement({ map, position: toLatLng(overlay.to), zIndex: 6, content: dot("#c8283e", "#fff", 20) }));
    }
    const pts = [...overlay.walk.flat(), ...overlay.bus.flatMap(b => b.coords)];
    if (pts.length > 1) {
      const bounds = new libs.core.LatLngBounds();
      pts.forEach(p => bounds.extend(toLatLng(p)));
      map.fitBounds(bounds, { top: 70, left: 40, right: 40, bottom: bottomPadding + 40 });
    }
    // Framing uses the padding at the time the trip appears; sheet drags are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, ready]);

  // Google Maps has no persistent padding, so keep the view centered above the sheet by panning.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const delta = bottomPadding - lastPadding.current;
    lastPadding.current = bottomPadding;
    if (delta) map.panBy(0, delta / 2);
  }, [bottomPadding, ready]);

  // Live buses, keyed by vehicle so they move instead of blinking.
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    const seen = new Set<string>();
    for (const bus of buses) {
      seen.add(bus.id);
      const route = routes.find(r => r.id === bus.routeId);
      let m = busMarkers.current.get(bus.id);
      if (!m) {
        const el = busElement(route?.color ?? "#a8781f", route?.abbr ?? "Bus");
        el.style.transform = "translateY(50%)"; // center the disc on the position
        m = new libs.marker.AdvancedMarkerElement({ map, content: el, zIndex: 10, title: `${route?.name ?? "Bus"} bus ${bus.id}` });
        busMarkers.current.set(bus.id, m);
      }
      m.position = { lat: bus.lat, lng: bus.lng };
      setBusHeading(m.content as HTMLElement, bus.heading);
    }
    for (const [id, m] of busMarkers.current) {
      if (!seen.has(id)) { detach(m); busMarkers.current.delete(id); }
    }
  }, [buses, routes, ready]);

  // The traveler's location.
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    if (userMarker.current) detach(userMarker.current);
    userMarker.current = null;
    if (!userLocation) return;
    const el = document.createElement("div");
    el.className = "h-4 w-4 rounded-full border-[3px] border-white bg-sky-500 shadow-[0_0_0_6px_rgba(14,165,233,0.25)]";
    el.style.transform = "translateY(50%)";
    userMarker.current = new libs.marker.AdvancedMarkerElement({ map, position: toLatLng(userLocation), content: el, zIndex: 11, title: "Your location" });
  }, [userLocation, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" aria-label="Campus map" role="region" />
    </div>
  );
}
