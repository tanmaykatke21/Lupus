import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildNetwork, stopById, type RawRoute, type RawStop } from "./network";
import { relevantRouteIds } from "./relevance";

const json = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "data", "samples", name), "utf8"));
const network = buildNetwork(json("routes-1430.json").get_routes as RawRoute[], json("stops-1430.json").get_stops as RawStop[], "saved");
const at = (id: number) => ({ lat: stopById(network, id)!.lat, lng: stopById(network, id)!.lng });

describe("relevantRouteIds", () => {
  it("keeps only routes that stop near the destination", () => {
    // Port Jefferson Village (46) is served only by the Port Jefferson Shuttle (route 8).
    expect(relevantRouteIds(network, at(46), null)).toEqual([8]);
  });

  it("narrows to routes serving both ends when the start is known", () => {
    // Chapin Apartments (32) is served by Hospital/Chapin (4) and Port Jeff (8). No route serves both the
    // LIRR stop (19) and Chapin, so it falls back to the destination's routes rather than showing nothing.
    expect(relevantRouteIds(network, at(32), at(19))).toEqual([4, 8]);
    // From SAC (1), which all three campus routes serve, both Chapin routes qualify.
    expect(relevantRouteIds(network, at(32), at(1))).toEqual([4, 8]);
    // LIRR (19) to M&H Quad (24): only the Outer Loop serves both.
    expect(relevantRouteIds(network, at(24), at(19))).toEqual([3]);
  });
});
