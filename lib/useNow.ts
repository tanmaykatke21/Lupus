"use client";

import { useSyncExternalStore } from "react";

// One shared 1 s ticker. The server snapshot is 0 so prerendering never reads the clock.
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => { now = Date.now(); listeners.forEach(l => l()); }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}

export function useNow() {
  return useSyncExternalStore(subscribe, () => now || Date.now(), () => 0);
}

export function countdown(ms: number) {
  if (ms <= 0) return "now";
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  if (s >= 600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
