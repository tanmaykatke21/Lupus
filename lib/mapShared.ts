// Shared by both map renderers (Google Maps and the MapLibre fallback).
import { laneRoutes, type LanePiece } from "./lanes";
import type { Bus, BusRoute, BusStop, LngLat } from "./types";

export const CAMPUS_CENTER: LngLat = [-73.1235, 40.9125];

export interface TripPaths {
  walk: LngLat[][];
  bus: { coords: LngLat[]; color: string; routeId: number }[];
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

/** Opacity of route lines that aren't the one being ridden (as on Tanmay's branch). */
export const FADED = 0.45;

/**
 * Which routes the map draws, as on Tanmay's branch: everything when no trip is shown; with a trip, only the
 * routes that can take you there (the chosen option's and the alternatives'), with the ridden one solid; and
 * none for a trip that's just a walk. Returned as a string so it's cheap to memoize on.
 */
export function routeFocusKey(overlay: TripOverlay | null | undefined): string {
  if (!overlay) return "all";
  const ridden = [...new Set(overlay.bus.map(b => b.routeId))].sort((a, b) => a - b);
  if (!ridden.length) return "none";
  const others = new Set((overlay.alternatives ?? []).flatMap(a => a.bus.map(b => b.routeId)));
  return `${ridden.join(",")}|${[...others].filter(id => !ridden.includes(id)).sort((a, b) => a - b).join(",")}`;
}

export interface RouteLane extends LanePiece {
  color: string;
  /** The route being ridden: drawn solid and on top; the rest are FADED. */
  solid: boolean;
}

/** Route lines for the routes being shown, split into side-by-side lanes where routes share a road. */
export function routeLanes(routes: BusRoute[], focusKey: string): RouteLane[] {
  if (focusKey === "none") return [];
  const ids = (part: string | undefined) => (part ?? "").split(",").filter(Boolean).map(Number);
  const [riddenPart, othersPart] = focusKey.split("|");
  const ridden = focusKey === "all" ? [] : ids(riddenPart);
  const others = ids(othersPart);
  const shown = focusKey === "all" ? routes : routes.filter(r => ridden.includes(r.id) || others.includes(r.id));
  const color = new Map(routes.map(r => [r.id, r.color]));
  return laneRoutes(shown.map(r => ({ id: r.id, coords: r.shape }))).map(p => ({
    ...p,
    color: color.get(p.id) ?? "#262840",
    solid: ridden.includes(p.id),
  }));
}

/** Where the ridden bus is boarded and left: the ends of each bus leg. */
export function rideEnds(overlay: TripOverlay | null | undefined): { kind: "board" | "alight"; at: LngLat }[] {
  return (overlay?.bus ?? []).filter(b => b.coords.length > 1).flatMap(b => [
    { kind: "board" as const, at: b.coords[0] },
    { kind: "alight" as const, at: b.coords[b.coords.length - 1] },
  ]);
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
