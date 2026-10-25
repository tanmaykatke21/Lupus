"use client";

import { useEffect, useState } from "react";
import type { LatLng } from "@/lib/geo";

export type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | {
      status: "found";
      position: LatLng;
      accuracyM: number;
      /** Direction of travel in degrees from north, when the phone is moving and knows it. */
      heading: number | null;
      /** When the fix was taken (ms). */
      at: number;
      /** How many fixes have arrived since watching started. */
      count: number;
    }
  | { status: "denied" }
  | { status: "unavailable" };

/** Watches the phone's location while `active` is true. Browsers only share it over HTTPS or on localhost. */
export function useLocation(active: boolean): LocationState {
  const [state, setState] = useState<LocationState>({ status: "idle" });
  useEffect(() => {
    if (!active) return;
    if (!("geolocation" in navigator)) {
      const t = setTimeout(() => setState({ status: "unavailable" }), 0);
      return () => clearTimeout(t);
    }
    const first = setTimeout(() => setState((s) => (s.status === "found" ? s : { status: "locating" })), 0);
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        setState((s) => ({
          status: "found",
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracyM: pos.coords.accuracy,
          heading: Number.isFinite(pos.coords.heading) && (pos.coords.speed ?? 0) > 0.3 ? pos.coords.heading : null,
          at: pos.timestamp || Date.now(),
          count: (s.status === "found" ? s.count : 0) + 1,
        })),
      (err) =>
        setState((s) => {
          if (err.code === err.PERMISSION_DENIED) return { status: "denied" };
          // A phone standing still often sends no new position for a while, and a weak signal can drop out
          // for a moment; neither means the last position is wrong, so keep it.
          return s.status === "found" ? s : { status: "unavailable" };
        }),
      // Always a fresh fix (no cached positions), and no timeout: the watch keeps going however long GPS takes.
      { enableHighAccuracy: true, maximumAge: 0 },
    );
    return () => {
      clearTimeout(first);
      navigator.geolocation.clearWatch(id);
    };
  }, [active]);
  return state;
}
