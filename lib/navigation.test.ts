import { describe, expect, it } from "vitest";
import { locate, nextStep, prepareRoute, splitRoute, stepText, OFF_ROUTE_M } from "./navigation";

const LAT0 = 40.912;
const LNG0 = -73.123;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
/** [lng, lat] at x meters east and y meters north of a spot on campus. */
const p = (x: number, y: number): [number, number] => [LNG0 + x / KX, LAT0 + y / KY];
const ll = (x: number, y: number) => ({ lng: LNG0 + x / KX, lat: LAT0 + y / KY });

describe("prepareRoute and turns", () => {
  it("measures the route", () => {
    const r = prepareRoute([p(0, 0), p(100, 0), p(100, 50)]);
    expect(r.total).toBeCloseTo(150, 0);
  });

  it("finds a left and a right turn", () => {
    // East 100 m, then north (a left), then east again (a right).
    const r = prepareRoute([p(0, 0), p(100, 0), p(100, 80), p(200, 80)]);
    expect(r.turns.map((t) => t.kind)).toEqual(["left", "right"]);
    expect(r.turns[0].atM).toBeCloseTo(100, 0);
  });

  it("ignores gentle bends and treats a quick jog as one turn", () => {
    const gentle = prepareRoute([p(0, 0), p(100, 5), p(200, 0)]);
    expect(gentle.turns).toEqual([]);
    // Two 45° bends 7 m apart make one 90° right turn.
    const jog = prepareRoute([p(0, 0), p(100, 0), p(105, -5), p(105, -100)]);
    expect(jog.turns.map((t) => t.kind)).toEqual(["right"]);
  });
});

describe("turns at junctions", () => {
  // A link from a building to the path, the path east then north, and a link to the destination.
  const coords = [p(0, -10), p(0, 0), p(100, 0), p(100, 80), p(110, 80)];

  it("announces a bend where paths meet", () => {
    const r = prepareRoute(coords, [2]);
    expect(r.turns.map((t) => t.kind)).toEqual(["left"]);
    expect(r.turns[0].atM).toBeCloseTo(110, 0);
  });

  it("follows a bend in a single path without announcing it", () => {
    expect(prepareRoute(coords, []).turns).toEqual([]);
  });
});

describe("locate", () => {
  const r = prepareRoute([p(0, 0), p(200, 0)]);

  it("snaps a nearby position onto the route", () => {
    const fix = locate(r, ll(50, 8), null);
    expect(fix.progressM).toBeCloseTo(50, 0);
    expect(fix.offM).toBeCloseTo(8, 0);
    expect(fix.snapped[1]).toBeCloseTo(LAT0, 6);
    expect(fix.bearing).toBeCloseTo(90, 0); // heading east
  });

  it("notices a walker who has left the route", () => {
    expect(locate(r, ll(50, 45), null).offM).toBeGreaterThan(OFF_ROUTE_M);
  });

  it("doesn't step back for small GPS jitter", () => {
    expect(locate(r, ll(95, 3), 100).progressM).toBe(100);
  });

  it("catches up after a GPS gap instead of calling it leaving the route", () => {
    const long = prepareRoute([p(0, 0), p(1000, 0), p(1000, 300)]);
    // Last seen 100 m in, next seen 600 m along the route (on the far stretch, past the corner).
    const fix = locate(long, ll(1003, 200), 100);
    expect(fix.progressM).toBeCloseTo(1200, 0);
    expect(fix.offM).toBeLessThan(OFF_ROUTE_M);
  });

  it("stays on the stretch being walked when the route doubles back alongside itself", () => {
    // Out 200 m east, a short hop north, and back 200 m west on a path 12 m away.
    const loop = prepareRoute([p(0, 0), p(200, 0), p(200, 12), p(0, 12)]);
    // Halfway out, a position between the two paths belongs to the way out...
    expect(locate(loop, ll(100, 7), 95).progressM).toBeCloseTo(100, 0);
    // ...and on the way back, the same position belongs to the way back.
    expect(locate(loop, ll(100, 5), 300).progressM).toBeCloseTo(312, 0);
  });
});

describe("next step", () => {
  const r = prepareRoute([p(0, 0), p(100, 0), p(100, 80)]);

  it("announces the next turn with the distance to it", () => {
    expect(stepText(nextStep(r, 40))).toBe("Turn left in 60 m");
    expect(stepText(nextStep(r, 95))).toBe("Turn left now");
  });

  it("announces arrival after the last turn", () => {
    expect(stepText(nextStep(r, 110))).toBe("Arrive in 70 m");
    expect(stepText(nextStep(r, 175))).toBe("You're almost there");
  });
});

describe("splitRoute", () => {
  it("splits at the walker's spot", () => {
    const r = prepareRoute([p(0, 0), p(100, 0), p(100, 80)]);
    const { walked, ahead } = splitRoute(r, 50);
    expect(walked).toHaveLength(2);
    expect(walked[1][0]).toBeCloseTo(p(50, 0)[0], 7);
    expect(ahead[0]).toEqual(walked[1]);
    expect(ahead).toHaveLength(3);
  });
});
