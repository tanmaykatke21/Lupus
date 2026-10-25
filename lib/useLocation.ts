"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LngLat } from "./types";

export type LocationStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

// Watches the device location once the user asks for it (browsers require a gesture-ish context).
export function useLocation() {
  const [coords, setCoords] = useState<LngLat | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  // Direction of travel from GPS (degrees from north), when moving; a fallback for phones without a compass.
  const [course, setCourse] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) { setStatus("unavailable"); return; }
    if (watchId.current !== null) return;
    setStatus("locating");
    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        setCoords([pos.coords.longitude, pos.coords.latitude]);
        setStatus("ok");
        const { heading, speed } = pos.coords;
        if (heading !== null && !Number.isNaN(heading) && (speed ?? 0) > 0.5) setCourse(heading);
      },
      err => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  return { coords, status, start, course };
}
