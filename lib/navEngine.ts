// Live navigation for one trip: walk (to the stop), ride, walk (to the destination). Feed it positions; it
// keeps the walker on the route, re-routes when they leave it, moves through the trip's phases and reports a
// snapshot for the screen. No React or browser APIs here, so it can be tested on its own.

import { meters, WALK_M_PER_MIN, type LatLng } from "./geo";
import {
  ARRIVED_M,
  OFF_ROUTE_M,
  locate,
  nextStep,
  pointAt,
  prepareRoute,
  splitRoute,
  stepText,
  type NavRoute,
  type TurnKind,
} from "./navigation";

export interface NavPlace extends LatLng {
  name: string;
}

export interface NavPlan {
  /** Where the trip was planned from: the demo walk starts here. */
  origin: LatLng;
  destination: NavPlace;
  /** Present for a bus trip: walk to `board`, ride, then walk from `alight`. */
  bus: {
    board: NavPlace;
    alight: NavPlace;
    boardStopId: number;
    alightStopId: number;
    routeId: number;
    busId: string;
  } | null;
}

export type NavPhase = "to-stop" | "ride" | "walk" | "arrived";

export interface Position extends LatLng {
  accuracyM?: number;
}

export interface NavSnapshot {
  phase: NavPhase;
  /** Where to show the walker: on the route when they're on it, otherwise where GPS says. */
  me: [number, number] | null;
  accuracyM: number | null;
  /** Direction to point the walker's arrow, degrees clockwise from north. */
  bearing: number | null;
  walked: [number, number][];
  ahead: [number, number][];
  /** "Turn left in 60 m", "Ride to Chapin Apartments", "You've arrived". */
  instruction: string;
  /** What the instruction is about, for its arrow; null while there's nothing to point at. */
  stepKind: TurnKind | "arrive" | "ride" | null;
  /** Where this part of the trip ends. */
  targetName: string;
  remainingM: number | null;
  remainingMin: number | null;
  offRoute: boolean;
  rerouting: boolean;
  /** Something the walker should know: no location yet, directions failed. */
  notice: string | null;
}

/** Gets walking directions: [lng, lat] points and where paths meet; null when they can't be had. */
export type FetchWalk = (from: LatLng, to: LatLng) => Promise<{ coords: [number, number][]; junctions?: number[] } | null>;

/** Off the route for this many fixes in a row means re-route (one stray fix is just GPS noise). */
const OFF_FIXES = 3;
const REROUTE_GAP_MS = 8000;
/** Near enough to the stop to get off: a ride ends once the rider is this close to it. */
const OFF_BUS_M = 60;

export class NavEngine {
  private phase: NavPhase;
  private route: NavRoute | null = null;
  private progress: number | null = null;
  private pos: Position | null = null;
  private shown: { me: [number, number]; bearing: number | null } | null = null;
  private offCount = 0;
  private offRoute = false;
  private rerouting = false;
  private lastRerouteAt = -Infinity;
  private notice: string | null = "Finding your location";
  private generation = 0;

  constructor(
    readonly plan: NavPlan,
    private fetchWalk: FetchWalk,
    private onChange: (s: NavSnapshot) => void,
    private now: () => number = () => Date.now(),
  ) {
    this.phase = plan.bus ? "to-stop" : "walk";
  }

  get currentRoute(): NavRoute | null {
    return this.route;
  }
  get currentProgress(): number | null {
    return this.progress;
  }
  get currentPhase(): NavPhase {
    return this.phase;
  }

  private target(): NavPlace {
    return this.phase === "to-stop" && this.plan.bus ? this.plan.bus.board : this.plan.destination;
  }

  /** A new position from GPS (or the demo walk). */
  update(pos: Position): void {
    this.pos = pos;
    if (this.notice === "Finding your location") this.notice = null;
    if (this.phase === "arrived") return this.emit();

    if (this.phase === "ride") {
      const alight = this.plan.bus!.alight;
      this.shown = { me: [pos.lng, pos.lat], bearing: null };
      if (meters(pos, alight) <= OFF_BUS_M) this.startWalk();
      return this.emit();
    }

    if (!this.route) {
      // First position (or after a phase change): get directions from here.
      this.shown = { me: [pos.lng, pos.lat], bearing: null };
      if (!this.rerouting && this.now() - this.lastRerouteAt >= REROUTE_GAP_MS) void this.reroute(pos);
      return this.emit();
    }

    const fix = locate(this.route, pos, this.progress);
    // Poor accuracy can look like leaving the route; only count it when GPS is sure enough.
    const sure = (pos.accuracyM ?? 0) < fix.offM;
    if (fix.offM > OFF_ROUTE_M && sure) {
      this.offCount++;
      this.offRoute = this.offCount >= OFF_FIXES;
    } else {
      this.offCount = 0;
      this.offRoute = false;
    }

    if (this.offRoute) {
      // Show where they really are, and find a new way from there.
      this.shown = { me: [pos.lng, pos.lat], bearing: null };
      if (!this.rerouting && this.now() - this.lastRerouteAt >= REROUTE_GAP_MS) void this.reroute(pos);
      return this.emit();
    }

    this.progress = fix.progressM;
    this.shown = { me: fix.snapped, bearing: fix.bearing };
    const left = this.route.total - fix.progressM;
    if (left <= ARRIVED_M || meters(pos, this.target()) <= ARRIVED_M) {
      if (this.phase === "to-stop") this.startRide();
      else this.arrive();
    }
    this.emit();
  }

  /** The rider says they're off the bus (or GPS didn't notice). */
  gotOffBus(): void {
    if (this.phase === "ride" || this.phase === "to-stop") {
      this.startWalk();
      this.emit();
    }
  }

  private startRide() {
    this.phase = "ride";
    this.clearRoute();
  }

  private startWalk() {
    this.phase = "walk";
    this.clearRoute();
    // Walk directions start from the stop; the next position re-routes if they're elsewhere.
    if (this.plan.bus) void this.reroute(this.pos && meters(this.pos, this.plan.bus.alight) < OFF_BUS_M ? this.pos : this.plan.bus.alight);
  }

  private arrive() {
    this.phase = "arrived";
    this.progress = this.route?.total ?? null;
    this.offRoute = false;
  }

  private clearRoute() {
    this.route = null;
    this.progress = null;
    this.offCount = 0;
    this.offRoute = false;
    this.generation++;
  }

  private async reroute(from: LatLng) {
    const gen = ++this.generation;
    const phase = this.phase;
    this.rerouting = true;
    this.lastRerouteAt = this.now();
    this.emit();
    let walk: Awaited<ReturnType<FetchWalk>> = null;
    try {
      walk = await this.fetchWalk(from, this.target());
    } catch {
      walk = null;
    }
    const coords = walk?.coords ?? null;
    // A newer request or a phase change made this answer stale.
    if (gen !== this.generation || phase !== this.phase) return;
    this.rerouting = false;
    if (!coords || coords.length < 2) {
      this.notice = "Couldn't get walking directions. Trying again as you move.";
      this.lastRerouteAt = this.now();
      return this.emit();
    }
    this.notice = null;
    this.route = prepareRoute(coords, walk?.junctions);
    this.progress = null;
    this.offCount = 0;
    this.offRoute = false;
    if (this.pos) return this.update(this.pos);
    this.emit();
  }

  snapshot(): NavSnapshot {
    const target = this.target();
    const base = {
      phase: this.phase,
      me: this.shown?.me ?? null,
      accuracyM: this.pos?.accuracyM ?? null,
      bearing: this.shown?.bearing ?? null,
      targetName: target.name,
      offRoute: this.offRoute,
      rerouting: this.rerouting,
      notice: this.notice,
    };
    if (this.phase === "arrived") {
      return {
        ...base,
        walked: this.route?.coords ?? [],
        ahead: [],
        instruction: `You've arrived at ${target.name}`,
        stepKind: "arrive",
        remainingM: 0,
        remainingMin: 0,
      };
    }
    if (this.phase === "ride") {
      const alight = this.plan.bus!.alight;
      const left = this.pos ? meters(this.pos, alight) : null;
      return {
        ...base,
        targetName: alight.name,
        walked: [],
        ahead: [],
        instruction: `Ride to ${alight.name}`,
        stepKind: "ride",
        remainingM: left,
        remainingMin: null,
      };
    }
    if (!this.route) {
      return {
        ...base,
        walked: [],
        ahead: [],
        instruction: this.rerouting ? "Getting directions" : "Waiting for your location",
        stepKind: null,
        remainingM: null,
        remainingMin: null,
      };
    }
    const progress = this.progress ?? 0;
    const { walked, ahead } = this.progress === null ? { walked: [], ahead: this.route.coords } : splitRoute(this.route, progress);
    const remainingM = Math.max(0, this.route.total - progress);
    const step = nextStep(this.route, progress);
    return {
      ...base,
      walked,
      ahead,
      instruction: this.offRoute ? (this.rerouting ? "Finding a new way" : "Head back to the path") : stepText(step),
      stepKind: this.offRoute ? null : step.kind,
      remainingM,
      remainingMin: remainingM / WALK_M_PER_MIN,
    };
  }

  private emit() {
    this.onChange(this.snapshot());
  }
}

/** The demo walk: the next position along the current route, `stepM` farther on, with a little GPS wobble. */
export function demoStep(engine: NavEngine, from: LatLng, stepM: number, wobble = Math.random): LatLng {
  const plan = engine.plan;
  const jitter = (v: number) => (wobble() - 0.5) * 2 * v; // up to ±v meters
  const nudge = (p: [number, number]): LatLng => ({
    lng: p[0] + jitter(2.5) / (111_320 * Math.cos((p[1] * Math.PI) / 180)),
    lat: p[1] + jitter(2.5) / 110_540,
  });
  if (engine.currentPhase === "ride" && plan.bus) {
    // On the bus: glide toward the stop where they get off.
    const to = plan.bus.alight;
    const d = meters(from, to);
    const t = d <= stepM * 3 ? 1 : (stepM * 3) / d;
    return { lng: from.lng + (to.lng - from.lng) * t, lat: from.lat + (to.lat - from.lat) * t };
  }
  const route = engine.currentRoute;
  if (!route) return from;
  return nudge(pointAt(route, (engine.currentProgress ?? 0) + stepM));
}
