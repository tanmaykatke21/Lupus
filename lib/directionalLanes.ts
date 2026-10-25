// Draws bus routes like traffic: every route sits on the right-hand side of its own direction of travel.
//  - Opposite directions on the same road land on opposite sides, far apart (BASE lanes each way from
//    the centerline) — including a route's own out-and-back.
//  - Routes going the same way on a stretch stack side by side, one lane apart: close, never on top.
//  - Where a stretch only carries one direction, its routes are centered on the road instead.
// Lanes are in "lane units"; the renderer turns a unit into pixels for the current zoom.

export interface LaneRoute { id: number; coords: [number, number][] }
export interface LaneLine { id: number; coords: [number, number][]; lanes: number[] }

/** Distance (lane units) from the road's center to the nearest lane when both directions are present. */
export const BASE = 1.5;
const SHARE_M = 18; // closer than this and parallel = the same road
const PARALLEL = 0.85; // |cos| of the angle between directions
const STEP_M = 15;
const CELL_M = 40;
const MIN_RUN = 3; // ignore lane flickers shorter than this many steps
const EASE = 2; // ease lane changes over ±2 steps (~60 m)

interface Step { r: number; i: number; ax: number; ay: number; bx: number; by: number; mx: number; my: number; dx: number; dy: number }

function distToStep(px: number, py: number, s: Step) {
  const vx = s.bx - s.ax, vy = s.by - s.ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - s.ax) * vx + (py - s.ay) * vy) / len2)) : 0;
  return Math.hypot(px - (s.ax + t * vx), py - (s.ay + t * vy));
}

export function directionalLanes(routes: LaneRoute[]): LaneLine[] {
  const usable = routes.filter(r => r.coords.length >= 2);
  if (!usable.length) return [];
  let lat0 = 0, n = 0;
  for (const r of usable) for (const c of r.coords) { lat0 += c[1]; n++; }
  lat0 /= n;
  const lng0 = usable[0].coords[0][0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;

  // Densify into short steps so lanes can change mid-stretch.
  const points: [number, number][][] = usable.map(r => {
    const out: [number, number][] = [r.coords[0]];
    for (let k = 1; k < r.coords.length; k++) {
      const [a, b] = [r.coords[k - 1], r.coords[k]];
      const len = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
      if (len < 0.5) continue;
      const m = Math.max(1, Math.ceil(len / STEP_M));
      for (let s = 1; s <= m; s++) out.push([a[0] + ((b[0] - a[0]) * s) / m, a[1] + ((b[1] - a[1]) * s) / m]);
    }
    return out;
  });
  const steps: Step[][] = points.map((pts, r) => pts.slice(1).map((b, i) => {
    const a = pts[i];
    const ax = (a[0] - lng0) * kx, ay = (a[1] - lat0) * ky, bx = (b[0] - lng0) * kx, by = (b[1] - lat0) * ky;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return { r, i, ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2, dx: (bx - ax) / len, dy: (by - ay) / len };
  }));
  const grid = new Map<string, Step[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`;
  for (const list of steps) for (const s of list) {
    const k = key(s.mx, s.my);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
  }

  const rows = steps.map(list => list.map(s => {
    const same = new Set<number>([usable[s.r].id]);
    let opposite = false;
    const cx = Math.floor(s.mx / CELL_M), cy = Math.floor(s.my / CELL_M);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const o of grid.get(`${gx},${gy}`) ?? []) {
        if (o.r === s.r && Math.abs(o.i - s.i) <= 3) continue; // its own neighbors
        const dot = o.dx * s.dx + o.dy * s.dy;
        if (Math.abs(dot) < PARALLEL || distToStep(s.mx, s.my, o) > SHARE_M) continue;
        if (dot > 0) same.add(usable[o.r].id);
        else opposite = true; // traffic the other way here (another route, or this route coming back)
      }
    }
    const ids = [...same].sort((a, b) => a - b);
    const k = ids.indexOf(usable[s.r].id);
    // Both directions: keep right, far from the centerline. One direction: center the group.
    return opposite ? BASE + k : k - (ids.length - 1) / 2;
  }));

  // Drop flickers shorter than MIN_RUN steps when both sides agree.
  for (const row of rows) {
    let start = 0;
    while (start < row.length) {
      let end = start;
      while (end + 1 < row.length && row[end + 1] === row[start]) end++;
      const before = start > 0 ? row[start - 1] : undefined;
      const after = end + 1 < row.length ? row[end + 1] : undefined;
      if (end - start + 1 < MIN_RUN && before !== undefined && (after === undefined || after === before)) {
        for (let k = start; k <= end; k++) row[k] = before;
      }
      start = end + 1;
    }
  }

  return usable.map((r, ri) => {
    const row = rows[ri], pts = points[ri];
    const perPoint = pts.map((_, k) => row[Math.min(k, row.length - 1)] ?? 0);
    const closed = Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 5e-5 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 5e-5;
    const len = perPoint.length;
    const at = (k: number) => (closed ? perPoint[((k % (len - 1)) + (len - 1)) % (len - 1)] : perPoint[k]);
    const lanes = perPoint.map((_, k) => {
      let sum = 0, c = 0;
      for (let d = -EASE; d <= EASE; d++) { const v = at(k + d); if (v !== undefined) { sum += v; c++; } }
      return sum / c;
    });
    if (closed) lanes[len - 1] = lanes[0];
    return { id: r.id, coords: pts, lanes };
  });
}
