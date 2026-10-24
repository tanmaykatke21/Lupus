import type { Network } from "./network";

// Used only when a route isn't in ETA Spot's route list (for example, one added since the list was loaded).
const PALETTE = ["#E8264F", "#2F6FDB", "#0E8F67", "#C77A00", "#7A4CD9", "#0A86A3", "#B3437F", "#4F5D75"];

export function routeColor(routeId: number, network?: Network | null): string {
  return network?.routes.find((r) => r.id === routeId)?.color ?? PALETTE[Math.abs(routeId) % PALETTE.length];
}

export function routeName(routeId: number, network?: Network | null): string {
  return network?.routes.find((r) => r.id === routeId)?.name ?? `Route ${routeId}`;
}

/** Short label for chips and map markers: the route's abbreviation, or its number. */
export function routeLabel(routeId: number, network?: Network | null): string {
  const abbr = network?.routes.find((r) => r.id === routeId)?.abbr;
  return abbr && abbr.length <= 5 ? abbr : String(routeId);
}

/** Navy or white, whichever reads better on the route color (Port Jefferson's yellow needs dark text). */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs against navy (#262840, luminance ≈ 0.022).
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.072) ? "#FFFFFF" : "#262840";
}

export function stopName(stopId: number | null, network?: Network | null): string | null {
  if (stopId === null) return null;
  return network?.stops.find((s) => s.id === stopId)?.name ?? `stop ${stopId}`;
}
