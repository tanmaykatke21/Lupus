import { describe, expect, it } from "vitest";
import { routePieces, SHARED_COLOR } from "./routeDrawing";
import type { LngLat } from "./types";

// An east-west road ~850 m long, and a road heading north from its east end.
const W: LngLat = [-73.13, 40.912];
const E: LngLat = [-73.12, 40.912];
const N: LngLat = [-73.12, 40.92];

describe("routePieces", () => {
  it("draws a route that has the road to itself in its own color, as one piece", () => {
    const pieces = routePieces([{ id: 3, color: "#0a0", shape: [W, E] }]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].color).toBe("#0a0");
  });

  it("draws a shared road only once, in the shared color", () => {
    const pieces = routePieces([
      { id: 3, color: "#0a0", shape: [W, E] },
      { id: 4, color: "#a0a", shape: [W, E, N] },
    ]);
    const shared = pieces.filter(p => p.color === SHARED_COLOR);
    expect(shared).toHaveLength(1);
    expect(shared[0].routeIds).toEqual([3, 4]);
    // Route 4's own stretch north keeps its color; nothing of route 3 is drawn separately.
    expect(pieces.some(p => p.color === "#a0a")).toBe(true);
    expect(pieces.some(p => p.color === "#0a0")).toBe(false);
  });

  it("treats routes going opposite ways on the same road as shared too", () => {
    const pieces = routePieces([
      { id: 3, color: "#0a0", shape: [W, E] },
      { id: 8, color: "#ee0", shape: [E, W] },
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].color).toBe(SHARED_COLOR);
  });

  it("draws no stray dashes where a route briefly brushes another", () => {
    // Route 8 runs its own way, touching route 3's road for ~30 m in the middle.
    const S: LngLat = [-73.125, 40.9105], T: LngLat = [-73.1247, 40.912], U: LngLat = [-73.1243, 40.912], V: LngLat = [-73.124, 40.9135];
    const pieces = routePieces([
      { id: 3, color: "#0a0", shape: [W, E] },
      { id: 8, color: "#ee0", shape: [S, T, U, V] },
    ]);
    const yellowOrShared = pieces.filter(p => p.routeIds.includes(8));
    expect(yellowOrShared.every(p => p.color === "#ee0")).toBe(true); // no 30 m shared sliver
  });

  it("never offsets lines, so pieces lie exactly on the route", () => {
    const [piece] = routePieces([{ id: 3, color: "#0a0", shape: [W, E] }]);
    expect(piece.coords.every(p => p[1] === 40.912)).toBe(true);
  });
});
