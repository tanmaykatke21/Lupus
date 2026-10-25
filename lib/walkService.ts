// Server side: walking directions from the bundled campus path network, with a straight-line fallback
// when paths aren't loaded yet (npm run build:walkways) or a point is off the mapped area.
import walkways from "@/data/walkways.json";
import { meters, PATH_DETOUR, WALK_M_PER_MIN, type LatLng } from "./geo";
import { buildWalkGraph, walkRoute, type WalkData, type WalkGraph } from "./walkRoute";

export interface WalkResult {
  /** [lng, lat] points to draw. */
  coords: [number, number][];
  /** Indexes into `coords` where paths meet (where turns are announced during navigation). */
  junctions: number[];
  meters: number;
  minutes: number;
  /** "paths" follows real walkways; "straight" is a straight line with an estimated distance. */
  source: "paths" | "straight";
}

let graph: WalkGraph | null | undefined;
function getGraph(): WalkGraph | null {
  if (graph === undefined) graph = buildWalkGraph(walkways as WalkData);
  return graph;
}

export function hasWalkways(): boolean {
  return getGraph() !== null;
}

export function walkBetween(from: LatLng, to: LatLng): WalkResult {
  const g = getGraph();
  const path = g ? walkRoute(g, from, to) : null;
  if (path) {
    return { coords: path.coords, junctions: path.junctions, meters: path.meters, minutes: path.meters / WALK_M_PER_MIN, source: "paths" };
  }
  const m = meters(from, to) * PATH_DETOUR;
  return { coords: [[from.lng, from.lat], [to.lng, to.lat]], junctions: [], meters: m, minutes: m / WALK_M_PER_MIN, source: "straight" };
}
