"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useMemo, useRef, useState } from "react";
import { chainLanes } from "@/lib/laneJoin";
import { closeGaps, laneSpacingPx, laneWidthPx, metersPerPixel, offsetLine } from "@/lib/laneOffset";
import { turn } from "@/lib/compass";
import { busElement, CAMPUS_CENTER, FADED, FOLLOW_MIN_TURN, FOLLOW_TILT, FOLLOW_ZOOM, prefersDark, rideEnds, routeFocusKey, routeLanes, setBusHeading, type MapProps } from "@/lib/mapShared";
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

export default function GoogleMapView({ routes, stops, buses, overlay, userLocation, onStopClick, bottomPadding = 0, onError, fitKey, follow, onUserPan }: MapProps & { onError: () => void }) {
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
  const onPanRef = useRef(onUserPan);
  const overlayRef = useRef(overlay);
  const lastCamera = useRef<{ heading: number; lng: number; lat: number } | null>(null);
  useEffect(() => {
    onStopRef.current = onStopClick;
    onErrorRef.current = onError;
    onPanRef.current = onUserPan;
    overlayRef.current = overlay;
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
          // Vector rendering allows rotating and tilting the map for navigation.
          renderingType: "VECTOR",
          headingInteractionEnabled: true,
          tiltInteractionEnabled: true,
        });
        mapRef.current.addListener("dragstart", () => onPanRef.current?.());
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

  // Route lines, side by side in lanes where routes share a road. Google has no line offset, so each
  // lane's geometry is shifted by the lane spacing for the current zoom, and redone when zoom changes. The
  // stroke narrows with the spacing so neighboring lanes don't paint over each other. The route being ridden
  // is solid and on top; the rest are faded. Each connected run of a route is one polyline with its offset
  // varying point by point, so lane changes don't leave darker overlaps on the faded lines.
  const focusKey = routeFocusKey(overlay);
  const chains = useMemo(() => {
    const pieces = routeLanes(routes, focusKey);
    const style = new Map(pieces.map(p => [p.id, p]));
    return chainLanes(pieces).map(c => ({ ...c, color: style.get(c.id)!.color, solid: style.get(c.id)!.solid }));
  }, [routes, focusKey]);
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    routeLines.current.forEach(l => l.setMap(null));
    routeLines.current = chains.map(c => new libs.maps.Polyline({
      map, path: c.coords.map(toLatLng), strokeColor: c.color, strokeOpacity: c.solid ? 1 : FADED,
      strokeWeight: laneWidthPx(map.getZoom() ?? 15), zIndex: c.solid ? 2 : 1, clickable: false,
    }));
    const place = () => {
      const zoom = map.getZoom() ?? 15;
      const m = laneSpacingPx(zoom) * metersPerPixel(CAMPUS_CENTER[1], zoom);
      const strokeWeight = laneWidthPx(zoom);
      // Loose ends reach up to two lanes (plus a little) to the rest of their route.
      const paths = closeGaps(chains.map(c => ({ id: c.id, path: offsetLine(c.coords, c.lanes.map(l => l * m)) })), 2 * m + 5);
      paths.forEach((path, i) => {
        routeLines.current[i]?.setPath(path.map(toLatLng));
        routeLines.current[i]?.setOptions({ strokeWeight });
      });
    };
    place();
    const listener = map.addListener("zoom_changed", place);
    return () => listener.remove();
  }, [chains, ready]);

  // Stops.
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current;
    if (!map || !libs) return;
    stopMarkers.current.forEach(detach);
    stopMarkers.current = stops.map(s => {
      const m = new libs.marker.AdvancedMarkerElement({
        map, position: { lat: s.lat, lng: s.lng }, title: s.name, zIndex: 2,
        content: dot("#ffffff", "#8e8e93", 12),
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
    const walkColor = prefersDark() ? "#0a84ff" : "#007aff";
    // Walks of the other possible trips, faded, under the chosen one.
    for (const alt of overlay.alternatives ?? []) {
      for (const line of alt.walk) {
        if (line.length < 2) continue;
        tripShapes.current.push(new libs.maps.Polyline({
          map, path: line.map(toLatLng), strokeOpacity: 0, zIndex: 2, clickable: false,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.45, strokeColor: walkColor, scale: 2 }, offset: "0", repeat: "12px" }],
        }));
      }
    }
    for (const line of overlay.walk) {
      if (line.length < 2) continue;
      tripShapes.current.push(new libs.maps.Polyline({
        map, path: line.map(toLatLng), strokeOpacity: 0, zIndex: 5, clickable: false,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: walkColor, scale: 3 }, offset: "0", repeat: "10px" }],
      }));
    }
    // Where the bus is boarded and left (the ride itself is the solid route line, in its lane).
    for (const e of rideEnds(overlay)) {
      tripShapes.current.push(new libs.marker.AdvancedMarkerElement({ map, position: toLatLng(e.at), zIndex: 5, content: dot(e.kind === "board" ? "#262840" : "#E8264F", "#fff", 18) }));
    }
    if (overlay.from) {
      tripShapes.current.push(new libs.marker.AdvancedMarkerElement({ map, position: toLatLng(overlay.from), zIndex: 6, content: dot("#007aff", "#fff", 18) }));
    }
    if (overlay.to) {
      tripShapes.current.push(new libs.marker.AdvancedMarkerElement({ map, position: toLatLng(overlay.to), zIndex: 6, content: dot("#ff3b30", "#fff", 20) }));
    }
  }, [overlay, ready]);

  // Frame the trip only when the trip itself changes, so the user's own zoom is never undone.
  const following = !!follow?.on;
  useEffect(() => {
    const map = mapRef.current, libs = libsRef.current, trip = overlayRef.current;
    if (!map || !libs || !trip || !fitKey || following) return;
    const pts = [...trip.walk.flat(), ...trip.bus.flatMap(b => b.coords)];
    if (pts.length < 2) return;
    const bounds = new libs.core.LatLngBounds();
    pts.forEach(p => bounds.extend(toLatLng(p)));
    map.moveCamera({ heading: 0, tilt: 0 });
    map.fitBounds(bounds, { top: 70, left: 40, right: 40, bottom: lastPadding.current + 40 });
  }, [fitKey, ready, following]);

  // Follow mode: user centered (a little low, above the sheet), heading up, tilted.
  const heading = follow?.heading ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!following || !userLocation) {
      if (lastCamera.current) map.moveCamera({ heading: 0, tilt: 0 });
      lastCamera.current = null;
      return;
    }
    const prev = lastCamera.current;
    const h = heading ?? prev?.heading ?? 0;
    const moved = !prev || Math.abs(prev.lng - userLocation[0]) > 1e-5 || Math.abs(prev.lat - userLocation[1]) > 1e-5;
    if (prev && !moved && Math.abs(turn(prev.heading, h)) < FOLLOW_MIN_TURN) return;
    lastCamera.current = { heading: h, lng: userLocation[0], lat: userLocation[1] };
    const zoom = prev ? map.getZoom() ?? FOLLOW_ZOOM : Math.max(map.getZoom() ?? 0, FOLLOW_ZOOM);
    // Put the user 70% of the way down the visible map (above the sheet), looking forward:
    // the camera centers that many pixels "behind" them along the heading.
    const mapH = map.getDiv().clientHeight;
    const offsetPx = mapH / 2 - 0.7 * (mapH - lastPadding.current);
    const backM = offsetPx * metersPerPixel(userLocation[1], zoom);
    const rad = (h * Math.PI) / 180;
    const center = {
      lat: userLocation[1] - (backM * Math.cos(rad)) / 110_540,
      lng: userLocation[0] - (backM * Math.sin(rad)) / (111_320 * Math.cos((userLocation[1] * Math.PI) / 180)),
    };
    map.moveCamera({ center, heading: h, tilt: FOLLOW_TILT, zoom });
  }, [following, heading, userLocation, ready]);

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
        const el = busElement(route?.color ?? "#007aff", route?.abbr ?? "Bus");
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
