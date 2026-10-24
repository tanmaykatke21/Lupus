import { describe, expect, it } from "vitest";
import { getWalkGraph } from "./walkGraph";
import { WalkGraph, isShortcutOpen, type Shortcut, type WalkGraphFile } from "./walk";

// A square: 0-1-2 along the bottom, 0-3-2 over the top with stairs on 3-2.
// Long way round is 474 m; the shortcut cuts straight across.
const file: WalkGraphFile = {
  source: "test", builtAt: "", bbox: "",
  nodes: [[-73.13, 40.91], [-73.13, 40.912], [-73.127, 40.912], [-73.127, 40.91]],
  edges: [
    [0, 1, 222, 0, []],
    [1, 2, 252, 0, []],
    [0, 3, 252, 0, []],
    [3, 2, 222, 1, []],
  ],
};
const shortcut: Shortcut = {
  id: "hall", name: "Through the hall", accessible: true,
  entry: [-73.13, 40.91], exit: [-73.127, 40.912],
  hours: { wed: ["08:00", "22:00"] },
};
// 2026-10-21 is a Wednesday. 14:00 and 23:30 Eastern.
const OPEN = new Date("2026-10-21T18:00:00Z");
const CLOSED = new Date("2026-10-22T03:30:00Z");

describe("isShortcutOpen", () => {
  it("uses campus time, not UTC", () => {
    expect(isShortcutOpen(shortcut, OPEN)).toBe(true);
    expect(isShortcutOpen(shortcut, CLOSED)).toBe(false);
  });
  it("treats a missing day as closed", () => {
    expect(isShortcutOpen(shortcut, new Date("2026-10-24T16:00:00Z"))).toBe(false); // Saturday
  });
});

describe("WalkGraph", () => {
  const g = new WalkGraph(file, [shortcut]);

  it("takes an open shortcut", () => {
    const r = g.route([-73.13, 40.91], [-73.127, 40.912], { at: OPEN })!;
    expect(r.shortcuts.map(s => s.id)).toEqual(["hall"]);
    expect(r.meters).toBeLessThan(400);
  });

  it("skips a closed shortcut", () => {
    const r = g.route([-73.13, 40.91], [-73.127, 40.912], { at: CLOSED })!;
    expect(r.shortcuts).toEqual([]);
    expect(r.meters).toBeCloseTo(474, 0);
  });

  it("avoids stairs in accessible mode and walks slower", () => {
    const viaStairs = new WalkGraph({ ...file, edges: file.edges.map(e => (e[0] === 0 && e[1] === 1 ? [0, 1, 999, 0, []] : e)) as WalkGraphFile["edges"] });
    const normal = viaStairs.route([-73.13, 40.91], [-73.127, 40.912])!;
    const accessible = viaStairs.route([-73.13, 40.91], [-73.127, 40.912], { accessible: true })!;
    expect(normal.stairs).toBe(true);
    expect(accessible.stairs).toBe(false);
    expect(accessible.seconds).toBeGreaterThan(accessible.meters / 1.3);
  });

  it("returns a path whose ends are the requested points", () => {
    const r = g.route([-73.1301, 40.9101], [-73.1271, 40.9121], { at: CLOSED })!;
    expect(r.coords[0]).toEqual([-73.1301, 40.9101]);
    expect(r.coords.at(-1)).toEqual([-73.1271, 40.9121]);
  });
});

describe("campus graph", () => {
  it("routes SAC to the LIRR station on real footpaths", () => {
    const r = getWalkGraph().route([-73.12492, 40.91435], [-73.12855, 40.92032])!;
    expect(r.meters).toBeGreaterThan(700);
    expect(r.meters).toBeLessThan(1600);
  });
});
