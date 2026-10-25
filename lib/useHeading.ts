"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { turn } from "./compass";

export type HeadingStatus = "idle" | "ok" | "denied" | "unsupported";

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionAPI = { requestPermission?: () => Promise<"granted" | "denied"> };

const screenAngle = () => (typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0);

/**
 * Which way the phone's top points, in degrees from north. iOS needs `start()` from a tap
 * (it asks permission); Android just starts. Desktops have no compass: status becomes "unsupported".
 */
export function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<HeadingStatus>("idle");
  const smooth = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    if (cleanup.current || typeof window === "undefined") return;
    if (!("DeviceOrientationEvent" in window)) { setStatus("unsupported"); return; }
    const api = DeviceOrientationEvent as unknown as PermissionAPI;
    if (typeof api.requestPermission === "function") {
      try {
        if ((await api.requestPermission()) !== "granted") { setStatus("denied"); return; }
      } catch {
        setStatus("denied");
        return;
      }
    }

    const update = (raw: number) => {
      // Low-pass filter around the circle so the needle doesn't jitter.
      const prev = smooth.current;
      const next = prev === null ? raw : (prev + turn(prev, raw) * 0.25 + 360) % 360;
      smooth.current = next;
      setHeading(next);
      setStatus("ok");
    };
    const onIOS = (e: Event) => {
      const h = (e as IOSOrientationEvent).webkitCompassHeading;
      if (typeof h === "number" && !Number.isNaN(h)) update((h + screenAngle()) % 360);
    };
    const onAbsolute = (e: Event) => {
      const { alpha, absolute } = e as DeviceOrientationEvent;
      if (alpha === null || (e.type === "deviceorientation" && !absolute)) return;
      update((360 - alpha + screenAngle()) % 360);
    };

    const absEvent = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener("deviceorientation", onIOS);
    window.addEventListener(absEvent, onAbsolute);
    cleanup.current = () => {
      window.removeEventListener("deviceorientation", onIOS);
      window.removeEventListener(absEvent, onAbsolute);
    };
    // No reading within 2 s means no compass (laptops).
    setTimeout(() => setStatus(s => (s === "ok" ? s : "unsupported")), 2000);
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  return { heading, status, start };
}
