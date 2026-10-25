import { describe, expect, it } from "vitest";
import type { LatLng } from "./geo";
import { demoStep, NavEngine, type FetchWalk, type NavPlan, type NavSnapshot } from "./navEngine";

const LAT0 = 40.912;
const LNG0 = -73.123;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
const at = (x: number, y: number) => ({ lng: LNG0 + x / KX, lat: LAT0 + y / KY });

/** Directions that go east first, then north: an L-shaped walk with one left turn. */
const lWalk = async (from: LatLng, to: LatLng) => ({
  coords: [
    [from.lng, from.lat],
    [to.lng, from.lat],
    [to.lng, to.lat],
  ] as [number, number][],
});
const flush = () => new Promise((r) => setTimeout(r, 0));

function start(plan: NavPlan, fetchWalk: FetchWalk = lWalk) {
  const seen: NavSnapshot[] = [];
  let clock = 0;
  const engine = new NavEngine(plan, fetchWalk, (s) => seen.push(s), () => clock);
  return {
    engine,
    last: () => seen[seen.length - 1],
    tick: (ms: number) => (clock += ms),
  };
}

const walkPlan: NavPlan = { origin: at(0, 0), destination: { ...at(200, 100), name: "Javits" }, bus: null };

describe("NavEngine walking", () => {
  it("gets directions from the first position and guides along them", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    expect(nav.last().instruction).toBe("Getting directions");
    await flush();
    expect(nav.last().instruction).toBe("Turn left in 200 m");
    expect(nav.last().remainingM).toBeCloseTo(300, 0);

    // 5 m north of the path, 120 m along: shown on the path.
    nav.engine.update(at(120, 5));
    const s = nav.last();
    expect(s.me![1]).toBeCloseTo(LAT0, 6);
    expect(s.instruction).toBe("Turn left in 80 m");
    expect(s.walked.length).toBeGreaterThan(1);
    expect(s.offRoute).toBe(false);
  });

  it("re-routes after two fixes well away from the path", async () => {
    const calls: LatLng[] = [];
    const nav = start(walkPlan, async (from, to) => {
      calls.push(from);
      return lWalk(from, to);
    });
    nav.engine.update(at(0, 0));
    await flush();
    nav.engine.update(at(50, 0));
    // Wander 45 m south of the path.
    nav.tick(10_000);
    nav.engine.update({ ...at(60, -45), accuracyM: 10 });
    expect(nav.last().offRoute).toBe(false); // one fix could be GPS noise
    // ...but the dot already shows where they are, with a line back to the path.
    expect(nav.last().me![1]).toBeCloseTo(at(60, -45).lat, 6);
    expect(nav.last().backToPath).toHaveLength(2);
    nav.engine.update({ ...at(62, -45), accuracyM: 10 });
    expect(nav.last().offRoute).toBe(true);
    expect(nav.last().rerouting).toBe(true);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].lat).toBeCloseTo(at(62, -45).lat, 6);
    expect(nav.last().offRoute).toBe(false);
    expect(nav.last().backToPath).toBeNull();
  });

  it("keeps showing a walker who carries on away from where a new route starts", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    await flush();
    // Directions start at (0, 0); walking 8 m the other way mustn't pin them back to that start.
    nav.engine.update({ ...at(-8, 0), accuracyM: 5 });
    expect(nav.last().me![0]).toBeCloseTo(at(-8, 0).lng, 6);
  });

  it("re-routes at once when the walker is far from the path", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    await flush();
    nav.tick(10_000);
    nav.engine.update({ ...at(60, -90), accuracyM: 10 });
    expect(nav.last().offRoute).toBe(true);
  });

  it("moves the dot off the path a little way out without calling it leaving", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    await flush();
    // 20 m off: too far to draw them on the path, not far enough to re-route.
    nav.engine.update({ ...at(80, 20), accuracyM: 8 });
    const s = nav.last();
    expect(s.offRoute).toBe(false);
    expect(s.me![1]).toBeCloseTo(at(80, 20).lat, 6);
    expect(s.instruction).toBe("Turn left in 120 m");
  });

  it("doesn't call it leaving the route when GPS is too vague to tell", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    await flush();
    for (let i = 0; i < 5; i++) {
      nav.tick(2000);
      nav.engine.update({ ...at(50, -40), accuracyM: 80 });
    }
    expect(nav.last().offRoute).toBe(false);
    // So vague a fix is drawn on the path.
    expect(nav.last().me![1]).toBeCloseTo(LAT0, 6);
  });

  it("tries again when directions don't come back", async () => {
    let calls = 0;
    const nav = start(walkPlan, async (from, to) => {
      calls++;
      return calls === 1 ? null : lWalk(from, to);
    });
    nav.engine.update(at(0, 0));
    await flush();
    expect(nav.last().notice).toMatch(/Couldn't get walking directions/);
    nav.tick(6000);
    nav.engine.update(at(5, 0));
    await flush();
    expect(calls).toBe(2);
    expect(nav.last().ahead.length).toBeGreaterThan(1);
  });

  it("says when you've arrived", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    await flush();
    nav.engine.update(at(200, 95));
    expect(nav.last().phase).toBe("arrived");
    expect(nav.last().instruction).toBe("You've arrived at Javits");
  });
});

describe("NavEngine bus trip", () => {
  const plan: NavPlan = {
    origin: at(0, 0),
    destination: { ...at(1200, 300), name: "Chapin Apartments" },
    bus: { board: { ...at(100, 0), name: "SAC" }, alight: { ...at(1000, 300), name: "Chapin" }, boardStopId: 1, alightStopId: 2, routeId: 4, busId: "b1" },
  };

  it("walks to the stop, rides, then walks to the destination", async () => {
    const nav = start(plan);
    nav.engine.update(at(0, 0));
    await flush();
    expect(nav.last().phase).toBe("to-stop");
    expect(nav.last().targetName).toBe("SAC");

    nav.engine.update(at(95, 0));
    expect(nav.last().phase).toBe("ride");
    expect(nav.last().instruction).toBe("Ride to Chapin");

    nav.engine.update(at(500, 150)); // on the bus
    expect(nav.last().phase).toBe("ride");
    nav.engine.update(at(980, 300)); // nearly at Chapin
    expect(nav.last().phase).toBe("walk");
    await flush();
    expect(nav.last().targetName).toBe("Chapin Apartments");
    expect(nav.last().remainingM).toBeGreaterThan(150);

    nav.engine.update(at(1195, 300));
    expect(nav.last().phase).toBe("arrived");
  });

  it("lets the rider say they got off", async () => {
    const nav = start(plan);
    nav.engine.update(at(0, 0));
    await flush();
    nav.engine.update(at(100, 0));
    nav.engine.gotOffBus();
    expect(nav.last().phase).toBe("walk");
  });
});

describe("demoStep", () => {
  it("moves the demo walker along the route", async () => {
    const nav = start(walkPlan);
    nav.engine.update(at(0, 0));
    await flush();
    const next = demoStep(nav.engine, at(0, 0), 20, () => 0.5);
    expect(next.lng).toBeCloseTo(at(20, 0).lng, 7);
    expect(next.lat).toBeCloseTo(LAT0, 7);
  });
});
