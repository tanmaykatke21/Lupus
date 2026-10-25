// Reports small self-crossing loops in today's routes, on the snapped centerline and as drawn
// (lane-offset) at a few zoom levels. Run: npx tsx scripts/find-loops.ts
import graphFile from "../data/road-graph.json";
import { directionalLanes } from "../lib/directionalLanes";
import { getRoutes } from "../lib/etaspot";
import { drawLane, laneUnitPx, metersPerPixel, offsetLineVar } from "../lib/laneOffset";
import { smallLoops } from "../lib/loopFinder";
import { RoadGraph, type RoadGraphFile } from "../lib/roadMatch";

const fmt = (xs: ReturnType<typeof smallLoops>) =>
  xs.slice(0, 6).map(x => `${x.at[1].toFixed(5)},${x.at[0].toFixed(5)} (${x.loopM}m)`).join("  ");

async function main() {
  const rg = new RoadGraph(graphFile as unknown as RoadGraphFile);
  const routes = (await getRoutes()).map(r => ({ ...r, shape: rg.match(r.shape) }));
  for (const r of routes) {
    const c = smallLoops(r.shape);
    console.log(`${r.name}: centerline loops ${c.length} ${fmt(c)}`);
  }
  const lines = directionalLanes(routes.map(r => ({ id: r.id, coords: r.shape })));
  for (const zoom of [15, 17, 19]) {
    const m = laneUnitPx(zoom) * metersPerPixel(40.914, zoom);
    for (const l of lines) {
      const name = routes.find(r => r.id === l.id)!.name;
      const before = smallLoops(offsetLineVar(l.coords, l.lanes.map(x => x * m)));
      const after = smallLoops(drawLane(l.coords, l.lanes, m));
      console.log(`z${zoom} ${name}: drawn loops before untangle ${before.length}, after ${after.length} ${fmt(after)}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
