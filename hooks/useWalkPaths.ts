"use client";

import { useEffect, useMemo, useState } from "react";
import type { LatLng } from "@/lib/geo";
import type { WalkResult } from "@/lib/walkService";

export interface WalkLeg {
  from: LatLng;
  to: LatLng;
}

// Rounded to about 10 m, so GPS jitter doesn't ask for a new route every second.
const round = (v: number) => v.toFixed(4);
const keyOf = (leg: WalkLeg) => `${round(leg.from.lat)},${round(leg.from.lng)};${round(leg.to.lat)},${round(leg.to.lng)}`;

// Walks already worked out, shared by every component for the whole visit.
const known = new Map<string, WalkResult>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function request(key: string) {
  if (known.has(key) || pending.has(key)) return;
  pending.add(key);
  const [from, to] = key.split(";");
  fetch(`/api/walk?from=${from}&to=${to}`)
    .then((res) => (res.ok ? (res.json() as Promise<WalkResult>) : null))
    .then((walk) => {
      if (walk) known.set(key, walk);
    })
    .catch(() => {})
    .finally(() => {
      pending.delete(key);
      listeners.forEach((fn) => fn());
    });
}

/** Walking directions for each leg along campus paths; null for a leg until its route arrives. */
export function useWalkPaths(legs: WalkLeg[]): (WalkResult | null)[] {
  const joined = legs.map(keyOf).join("|");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onDone = () => setVersion((v) => v + 1);
    listeners.add(onDone);
    return () => {
      listeners.delete(onDone);
    };
  }, []);

  useEffect(() => {
    if (joined) joined.split("|").forEach(request);
  }, [joined]);

  // `version` changes when any walk arrives, so the lookup below sees it.
  return useMemo(() => (joined ? joined.split("|").map((k) => known.get(k) ?? null) : []), [joined, version]); // eslint-disable-line react-hooks/exhaustive-deps
}
