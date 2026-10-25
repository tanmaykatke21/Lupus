// Where bus routes share a road, draw them side by side like lanes on a transit map instead of on top of
// one another. Each route is cut into pieces; every piece gets a lane number that MapLibre's line-offset
// turns into a sideways shift in pixels, so the lanes stay apart at every zoom level.

export interface LaneRoute {
  id: number;
  /** [lng, lat] pairs, as decodePolyline returns them. */
  coords: [number, number][];
}

export interface LanePiece {
  id: number;
  /**
   * Sideways lane, in line widths, relative to this piece's own direction of travel (positive is to the
   * right). 0 when the route has the road to itself; -0.5 / 0.5 for two routes; -1 / 0 / 1 for three.
   */
  lane: number;
  coords: [number, number][];
}

/** Routes closer than this (meters), running parallel, count as sharing the road. */
const SHARE_M = 18;
/** Long straight stretches are cut into steps of at most this length, so sharing can start mid-stretch. */
const STEP_M = 15;
/** Lane changes shorter than this many steps are treated as noise (a crossing street, a GPS wiggle). */
const MIN_RUN = 3;
const CELL_M = 40;
/** Marks a step that repeats road the same route already covers (the way back of an out-and-back). */
const REPEAT = Infinity;

interface Seg {
  r: number; // index into routes
  i: number; // index along the route
  ax: number;
  ay: number;
  bx: number;
  by: number;
  mx: number;
  my: number;
  dx: number; // unit direction
  dy: number;
}

function distToSeg(px: number, py: number, s: Seg): number {
  const vx = s.bx - s.ax;
  const vy = s.by - s.ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * vx + (py - s.ay) * vy) / len2));
  return Math.hypot(px - (s.ax + t * vx), py - (s.ay + t * vy));
}

export function laneRoutes(routes: LaneRoute[]): LanePiece[] {
  const usable = routes.filter((r) => r.coords.length >= 2);
  if (!usable.length) return [];

  // Flat x/y in meters around the routes' middle; plenty accurate across a campus.
  let lat0 = 0;
  let n = 0;
  for (const r of usable) {
    for (const c of r.coords) {
      lat0 += c[1];
      n++;
    }
  }
  lat0 /= n;
  const lng0 = usable[0].coords[0][0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;

  // Densify each route into short steps, remembering the [lng, lat] of every point.
  const points: [number, number][][] = usable.map((r) => {
    const out: [number, number][] = [r.coords[0]];
    for (let k = 1; k < r.coords.length; k++) {
      const [lngA, latA] = r.coords[k - 1];
      const [lngB, latB] = r.coords[k];
      const len = Math.hypot((lngB - lngA) * kx, (latB - latA) * ky);
      if (len < 0.5) continue; // repeated point
      const steps = Math.max(1, Math.ceil(len / STEP_M));
      for (let s = 1; s <= steps; s++) out.push([lngA + ((lngB - lngA) * s) / steps, latA + ((latB - latA) * s) / steps]);
    }
    return out;
  });

  const segs: Seg[][] = points.map((pts, r) =>
    pts.slice(1).map((b, i) => {
      const a = pts[i];
      const ax = (a[0] - lng0) * kx;
      const ay = (a[1] - lat0) * ky;
      const bx = (b[0] - lng0) * kx;
      const by = (b[1] - lat0) * ky;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      return { r, i, ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2, dx: (bx - ax) / len, dy: (by - ay) / len };
    }),
  );

  const grid = new Map<string, Seg[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`;
  for (const list of segs) for (const s of list) {
    const k = key(s.mx, s.my);
    const cell = grid.get(k);
    if (cell) cell.push(s);
    else grid.set(k, [s]);
  }

  const lanes: number[][] = segs.map((list) =>
    list.map((s) => {
      const cx = Math.floor(s.mx / CELL_M);
      const cy = Math.floor(s.my / CELL_M);
      // For each route sharing this stretch, its earliest matching piece (the reference for direction).
      const firstMatch = new Map<number, Seg>();
      firstMatch.set(s.r, s);
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const o of grid.get(`${gx},${gy}`) ?? []) {
            if (o.r === s.r && Math.abs(o.i - s.i) <= 3) continue; // its own neighbors, not a shared stretch
            if (Math.abs(o.dx * s.dx + o.dy * s.dy) < 0.85) continue; // crossing, not running alongside
            if (distToSeg(s.mx, s.my, o) > SHARE_M) continue;
            const prev = firstMatch.get(o.r);
            if (!prev || o.i < prev.i) firstMatch.set(o.r, o);
          }
        }
      // The way back along road this route already drove sits in the same lane, so draw that road once:
      // two faded strokes on top of each other would look like a darker, different line.
      if (firstMatch.get(s.r) !== s) return REPEAT;
      const sharing = [...firstMatch.keys()].sort((a, b) => usable[a].id - usable[b].id);
      if (sharing.length === 1) return 0;
      // Lanes are counted across the road in the direction the lowest-id route first travels it, so routes
      // going opposite ways (and an out-and-back route's return trip) all agree on which lane is whose.
      const ref = firstMatch.get(sharing[0])!;
      const sign = s.dx * ref.dx + s.dy * ref.dy >= 0 ? 1 : -1;
      return sign * (sharing.indexOf(s.r) - (sharing.length - 1) / 2);
    }),
  );

  // Smooth out lane flickers shorter than MIN_RUN steps when the lanes on both sides agree.
  for (const row of lanes) {
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

  // Join consecutive steps in the same lane into one piece.
  const pieces: LanePiece[] = [];
  lanes.forEach((row, r) => {
    const pts = points[r];
    let start = 0;
    for (let k = 1; k <= row.length; k++) {
      if (k === row.length || row[k] !== row[start]) {
        if (row[start] !== REPEAT) pieces.push({ id: usable[r].id, lane: row[start], coords: pts.slice(start, k + 1) });
        start = k;
      }
    }
  });
  return pieces;
}
