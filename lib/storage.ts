"use client";

import { useCallback, useSyncExternalStore } from "react";

// localStorage-backed state that is safe during SSR and syncs across components and tabs.
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try { raw = localStorage.getItem(`lupus.${key}`); } catch {}
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  if (raw !== null) {
    try { value = JSON.parse(raw); } catch {}
  }
  cache.set(key, { raw, value });
  return value;
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(`lupus.${key}`, JSON.stringify(value)); } catch {}
  listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}

export function useStored<T>(key: string, fallback: T) {
  const value = useSyncExternalStore(subscribe, () => read(key, fallback), () => fallback);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const prev = read(key, fallback);
    write(key, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
  }, [key, fallback]);
  return [value, set] as const;
}

export type SavedLabel = "Dorm" | "Dining hall" | "Lab" | "Lecture" | "Hospital" | "Other";
export const SAVED_LABELS: SavedLabel[] = ["Dorm", "Dining hall", "Lab", "Lecture", "Hospital", "Other"];

export interface SavedPlace {
  placeId: string;
  label: SavedLabel;
}

export interface Settings {
  accessible: boolean;
  trainBufferMin: number;
  language: string;
  voice: boolean;
}

export const DEFAULT_SETTINGS: Settings = { accessible: false, trainBufferMin: 5, language: "en", voice: true };
export const NO_SAVED: SavedPlace[] = [];
