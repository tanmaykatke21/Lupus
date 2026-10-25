// Shared by both map renderers (Google Maps and the MapLibre fallback).
import type { Bus, BusRoute, BusStop, LngLat } from "./types";

export const CAMPUS_CENTER: LngLat = [-73.1235, 40.9125];

export interface TripPaths {
  walk: LngLat[][];
  bus: { coords: LngLat[]; color: string }[];
}

export interface TripOverlay extends TripPaths {
  from?: LngLat;
  to?: LngLat;
  /** The other possible routes, drawn faded under the chosen one. */
  alternatives?: TripPaths[];
}

export interface MapProps {
  routes: BusRoute[];
  stops: BusStop[];
  buses: Bus[];
  overlay?: TripOverlay | null;
  userLocation?: LngLat | null;
  onStopClick?: (stop: BusStop) => void;
  bottomPadding?: number;
  /** Frame the trip only when this changes (new trip or option), never on routine refreshes. */
  fitKey?: string | null;
  /** Navigation follow mode: center on the user, rotate so their heading is up, tilt. */
  follow?: { on: boolean; heading: number | null };
  /** The user dragged the map (pauses follow mode). */
  onUserPan?: () => void;
}

export const FOLLOW_ZOOM = 18;
export const FOLLOW_TILT = 50;
/** Skip camera updates smaller than this, so a jittery compass doesn't thrash the map. */
export const FOLLOW_MIN_TURN = 4;

/** Bus marker: route-colored disc with a heading arrow. Rotate `.heading` to point it. */
export function busElement(color: string, abbr: string) {
  const el = document.createElement("div");
  el.className = "bus-marker";
  el.setAttribute("role", "img");
  el.innerHTML = `
    <svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true">
      <g class="heading">
        <path d="M17 1 L23 9 L11 9 Z" fill="${color}" stroke="#1d150b" stroke-width="1"/>
      </g>
      <circle cx="17" cy="18" r="11" fill="${color}" stroke="#f0c46a" stroke-width="2.5"/>
      <text x="17" y="21.5" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" font-family="system-ui">${abbr.slice(0, 3)}</text>
    </svg>`;
  return el;
}

export function setBusHeading(el: HTMLElement, heading: number) {
  el.querySelector<SVGGElement>(".heading")?.setAttribute("transform", `rotate(${heading} 17 18)`);
}

export function prefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
