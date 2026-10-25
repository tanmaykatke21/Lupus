// Turns lane numbers (lib/directionalLanes.ts) into sideways shifts of the line geometry, redone
// on zoom so lanes keep a constant spacing on screen.
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

/** Pixels per lane unit: never less than a line width plus a hair, so adjacent lanes never touch. */
export const laneUnitPx = (zoom: number) => Math.max(5.5, laneSpacingPx(zoom));

/** Web Mercator ground resolution (meters per CSS pixel) at a latitude and zoom. */
export const metersPerPixel = (lat: number, zoom: number) => (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/** Where segments a-b and c-d properly cross, if they do. */
function intersection(a: LngLat, b: LngLat, c: LngLat, d: LngLat): LngLat | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (!den) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

const groundM = (a: LngLat, b: LngLat) =>
  Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110_540);

/**
 * Removes the folds an offset line makes where the road curves tighter than the offset (the inside
 * lane of a sharp turn crosses itself). Any self-crossing within `maxLoopM` of path is cut at the
 * crossing point.
 */
export function untangle(line: LngLat[], maxLoopM: number): LngLat[] {
  const out: LngLat[] = [];
  let i = 0;
  while (i < line.length) {
    out.push(line[i]);
    let cut = -1, hit: LngLat | null = null, walked = 0;
    for (let j = i + 2; j + 1 < line.length; j++) {
      walked += groundM(line[j - 1], line[j]);
      if (walked > maxLoopM) break;
      const x = i + 1 < line.length ? intersection(line[i], line[i + 1], line[j], line[j + 1]) : null;
      if (x) { cut = j; hit = x; } // the furthest crossing in range removes the whole tangle
    }
    if (hit) { out.push(hit); i = cut + 1; } else i++;
  }
  return out;
}

/** A route's drawn line: lanes (in lane units) turned into meters, offset, then untangled. */
export function drawLane(line: LngLat[], lanes: number[], metersPerLane: number): LngLat[] {
  const offsets = lanes.map(l => l * metersPerLane);
  const maxOffset = Math.max(0, ...offsets.map(Math.abs));
  if (!maxOffset) return line;
  // A fold can't be longer than about one turn around the offset radius.
  return untangle(offsetLineVar(line, offsets), 2 * Math.PI * maxOffset + 10);
}

/** Shift a line to the right of its direction of travel by a per-point offset in meters (negative = left). */
export function offsetLineVar(line: LngLat[], offsetsM: number[]): LngLat[] {
  if (line.length < 2) return line;
  const lat0 = line[0][1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const dir = (a: LngLat, b: LngLat) => {
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  return line.map((p, i) => {
    const off = offsetsM[i] ?? 0;
    if (!off) return p;
    const a = dir(line[Math.max(0, i - 1)], line[Math.max(1, i)]);
    const b = dir(line[Math.min(line.length - 2, i)], line[Math.min(line.length - 1, i + 1)]);
    let nx = (a[1] + b[1]) / 2, ny = -(a[0] + b[0]) / 2;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    return [p[0] + (nx * off) / kx, p[1] + (ny * off) / ky];
  });
}
