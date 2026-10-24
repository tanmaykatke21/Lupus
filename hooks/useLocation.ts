"use client";

import { useEffect, useState } from "react";
import type { LatLng } from "@/lib/geo";

export type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "found"; position: LatLng; accuracyM: number }
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
        setState({
          status: "found",
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracyM: pos.coords.accuracy,
        }),
      (err) => setState({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => {
      clearTimeout(first);
      navigator.geolocation.clearWatch(id);
    };
  }, [active]);
  return state;
}
