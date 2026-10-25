// Reports small self-crossing loops in today's routes as drawn (snapped to roads, shared stretches
// once). Real turnarounds show up as long loops; short ones would be drawing artifacts.
// Run: npx tsx scripts/find-loops.ts
import graphFile from "../data/road-graph.json";
import { getRoutes } from "../lib/etaspot";
import { smallLoops } from "../lib/loopFinder";
import { RoadGraph, type RoadGraphFile } from "../lib/roadMatch";
import { routePieces } from "../lib/routeDrawing";

const fmt = (xs: ReturnType<typeof smallLoops>) =>
  xs.slice(0, 6).map(x => `${x.at[1].toFixed(5)},${x.at[0].toFixed(5)} (${x.loopM}m)`).join("  ");

async function main() {
  const rg = new RoadGraph(graphFile as unknown as RoadGraphFile);
  const routes = (await getRoutes()).map(r => ({ ...r, shape: rg.match(r.shape) }));
  for (const r of routes) console.log(`${r.name}: route loops under 100 m: ${fmt(smallLoops(r.shape, 100)) || "none"}`);
  const pieces = routePieces(routes);
  const shared = pieces.filter(p => p.routeIds.length > 1).length;
  const loops = pieces.flatMap(p => smallLoops(p.coords, 100));
  console.log(`${pieces.length} drawn pieces (${shared} shared), loops under 100 m: ${fmt(loops) || "none"}`);
}

main().catch(err => { console.error(err); process.exit(1); });
