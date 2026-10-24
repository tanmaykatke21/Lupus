// Server-side singleton for the campus walking graph.
import graphFile from "@/data/walk-graph.json";
import shortcutsFile from "@/data/shortcuts.json";
import { WalkGraph, type Shortcut, type WalkGraphFile } from "./walk";

let graph: WalkGraph | null = null;

export function getWalkGraph() {
  graph ??= new WalkGraph(graphFile as unknown as WalkGraphFile, shortcutsFile.shortcuts as Shortcut[]);
  return graph;
}
