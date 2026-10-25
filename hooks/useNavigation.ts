"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { demoStep, NavEngine, type FetchWalk, type NavPlan, type NavSnapshot } from "@/lib/navEngine";
import type { WalkResult } from "@/lib/walkService";

/** Demo walk: one step a second, about 7x walking pace so a campus walk takes a couple of minutes. */
const DEMO_STEP_M = 10;
const DEMO_TICK_MS = 1000;

const fetchWalk: FetchWalk = async (from: LatLng, to: LatLng) => {
  const q = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const res = await fetch(`/api/walk?from=${q(from)}&to=${q(to)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const walk = (await res.json()) as WalkResult;
  return { coords: walk.coords, junctions: walk.junctions };
};

interface WakeLockLike {
  release: () => Promise<void>;
}

/**
 * Live navigation for `plan` while it's set: follows GPS (or a demo walk along the route), keeps the screen
 * awake, and returns what to show. `gotOffBus` moves a bus trip on to its last walk.
 */
export function useNavigation(plan: NavPlan | null, demo: boolean) {
  const planKey = plan ? JSON.stringify(plan) : "";
  const [state, setState] = useState<{ key: string; snap: NavSnapshot } | null>(null);
  const engine = useRef<NavEngine | null>(null);

  useEffect(() => {
    if (!planKey) return;
    const thePlan = JSON.parse(planKey) as NavPlan;
    const nav = new NavEngine(thePlan, fetchWalk, (snap) => setState({ key: planKey, snap }));
    engine.current = nav;
    const stops: (() => void)[] = [];
    const tell = (notice: string) => setState({ key: planKey, snap: { ...nav.snapshot(), notice } });

    if (demo) {
      let pos: LatLng = thePlan.origin;
      const first = setTimeout(() => nav.update({ ...pos, accuracyM: 5 }), 0);
      const timer = setInterval(() => {
        pos = demoStep(nav, pos, DEMO_STEP_M);
        nav.update({ ...pos, accuracyM: 5 });
      }, DEMO_TICK_MS);
      stops.push(() => {
        clearTimeout(first);
        clearInterval(timer);
      });
    } else if ("geolocation" in navigator) {
      if (thePlan.startFix) {
        const fix = thePlan.startFix;
        const first = setTimeout(() => nav.update(fix), 0);
        stops.push(() => clearTimeout(first));
      }
      const id = navigator.geolocation.watchPosition(
        (p) => nav.update({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
        (err) => {
          // A pause in updates (standing still, a weak signal) isn't worth a warning once navigation has a fix.
          if (err.code !== err.PERMISSION_DENIED && nav.snapshot().me) return;
          tell(
            err.code === err.PERMISSION_DENIED
              ? "Location is off for this site. Turn it on to navigate, or try the demo walk."
              : "Can't get your location right now. Keep the app open outdoors.",
          );
        },
        { enableHighAccuracy: true, maximumAge: 0 },
      );
      stops.push(() => navigator.geolocation.clearWatch(id));
    } else {
      const t = setTimeout(() => tell("This browser can't share your location. Try the demo walk."), 0);
      stops.push(() => clearTimeout(t));
    }

    // Keep the screen on while navigating; the browser drops the lock when the tab is hidden, so take it again.
    let lock: WakeLockLike | null = null;
    const wake = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } }).wakeLock;
    const keepAwake = () => {
      if (wake && document.visibilityState === "visible") wake.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    stops.push(() => {
      document.removeEventListener("visibilitychange", keepAwake);
      lock?.release().catch(() => {});
    });

    return () => {
      stops.forEach((s) => s());
      if (engine.current === nav) engine.current = null;
    };
  }, [planKey, demo]);

  const gotOffBus = useCallback(() => engine.current?.gotOffBus(), []);
  return { snapshot: state && state.key === planKey ? state.snap : null, gotOffBus };
}
