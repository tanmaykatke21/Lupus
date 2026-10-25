// Turns lane numbers (from lib/lanes.ts) into sideways shifts. MapLibre does this natively with
// line-offset; Google Maps can't, so for it we move the geometry itself and redo it on zoom.
import type { LngLat } from "./types";

function interpolate(stops: [number, number][], zoom: number) {
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, v0] = stops[i - 1], [z1, v1] = stops[i];
    if (zoom <= z1) return v0 + ((zoom - z0) / (z1 - z0)) * (v1 - v0);
  }
  return stops[stops.length - 1][1];
}

/** Pixels between adjacent lanes at a zoom level (same curve as the MapLibre line-offset). */
export const laneSpacingPx = (zoom: number) => interpolate([[12, 3.2], [15, 5.6], [18, 9.5]], zoom);

/** Route line width at a zoom level: always narrower than laneSpacingPx, so lanes sit side by side without overlapping. */
export const laneWidthPx = (zoom: number) => interpolate([[12, 2.5], [15, 4.5], [18, 8]], zoom);

/** Web Mercator ground resolution (meters per CSS pixel) at a latitude and zoom. */
export const metersPerPixel = (lat: number, zoom: number) => (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/**
 * Shift a line `offsetM` meters to the right of its direction of travel (negative = left): one offset for the
 * whole line, or one per point.
 */
export function offsetLine(line: LngLat[], offsetM: number | number[]): LngLat[] {
  const at = (i: number) => (typeof offsetM === "number" ? offsetM : offsetM[i] ?? 0);
  if (line.length < 2 || (typeof offsetM === "number" ? !offsetM : offsetM.every(o => !o))) return line;
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
    return [p[0] + (nx * at(i)) / kx, p[1] + (ny * at(i)) / ky];
  });
}

/**
 * Where a route's line stops and carries on nearby (it rejoins road it already drew, or a loop meets
 * itself at a junction), the offset ends can sit a few meters apart. Extend each loose end to the nearest
 * point on the rest of the same route's lines when it's within `maxM`, so the route reads as connected.
 * Lines are already offset; `skipM` keeps an end from snapping back onto its own last stretch.
 */
export function closeGaps(lines: { id: number; path: LngLat[] }[], maxM: number, skipM = 30): LngLat[][] {
  const lat0 = lines.find(l => l.path.length)?.path[0][1] ?? 0;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const dist = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
  const nearestOn = (p: LngLat, a: LngLat, b: LngLat): LngLat => {
    const vx = (b[0] - a[0]) * kx, vy = (b[1] - a[1]) * ky;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * kx * vx + (p[1] - a[1]) * ky * vy) / len2));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  return lines.map((line, i) => {
    const path = line.path;
    if (path.length < 2) return path;
    // Distance along the line to each vertex, to skip the end's own last stretch.
    const along = [0];
    for (let k = 1; k < path.length; k++) along.push(along[k - 1] + dist(path[k - 1], path[k]));
    const total = along[along.length - 1];
    const reach = (atEnd: boolean): LngLat | null => {
      const p = atEnd ? path[path.length - 1] : path[0];
      let best: LngLat | null = null;
      let bestD = Infinity;
      for (let j = 0; j < lines.length; j++) {
        const other = lines[j];
        if (other.id !== line.id) continue;
        for (let k = 0; k < other.path.length - 1; k++) {
          if (j === i && (atEnd ? total - along[k + 1] : along[k]) < skipM) continue;
          const q = nearestOn(p, other.path[k], other.path[k + 1]);
          const d = dist(p, q);
          if (d < bestD) { bestD = d; best = q; }
        }
      }
      return bestD > 0.3 && bestD <= maxM ? best : null;
    };
    const head = reach(false), tail = reach(true);
    return [...(head ? [head] : []), ...path, ...(tail ? [tail] : [])];
  });
}
