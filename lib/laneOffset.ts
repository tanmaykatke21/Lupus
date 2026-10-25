// Turns lane numbers (from lib/lanes.ts) into sideways shifts. MapLibre does this natively with
// line-offset; Google Maps can't, so for it we move the geometry itself and redo it on zoom.
import type { LngLat } from "./types";

/** Pixels between adjacent lanes at a zoom level (same curve as the MapLibre line-offset). */
export function laneSpacingPx(zoom: number) {
  const stops: [number, number][] = [[12, 3.2], [15, 5.6], [18, 9.5]];
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, v0] = stops[i - 1], [z1, v1] = stops[i];
    if (zoom <= z1) return v0 + ((zoom - z0) / (z1 - z0)) * (v1 - v0);
  }
  return stops[stops.length - 1][1];
}

/** Web Mercator ground resolution (meters per CSS pixel) at a latitude and zoom. */
export const metersPerPixel = (lat: number, zoom: number) => (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/** Shift a line `offsetM` meters to the right of its direction of travel (negative = left). */
export function offsetLine(line: LngLat[], offsetM: number): LngLat[] {
  if (!offsetM || line.length < 2) return line;
  const lat0 = line[0][1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const dir = (a: LngLat, b: LngLat) => {
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  return line.map((p, i) => {
    // Average the directions of the segments on either side, so corners stay joined.
    const a = dir(line[Math.max(0, i - 1)], line[Math.max(1, i)]);
    const b = dir(line[Math.min(line.length - 2, i)], line[Math.min(line.length - 1, i + 1)]);
    let nx = (a[1] + b[1]) / 2, ny = -(a[0] + b[0]) / 2; // right-hand normal
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    return [p[0] + (nx * offsetM) / kx, p[1] + (ny * offsetM) / ky];
  });
}
