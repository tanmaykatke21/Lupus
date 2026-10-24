// MapLibre loads its map-rendering worker from a URL relative to its own file, which breaks once
// Next.js bundles it. Copy the worker into public/ so the app can point MapLibre at a stable URL.
// Runs automatically after `npm install` (see "postinstall" in package.json).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const dest = join(root, "public", "maplibre-gl-worker.mjs");

if (!existsSync(src)) {
  console.warn("[copy-maplibre-worker] maplibre-gl is not installed yet; skipping.");
} else {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("[copy-maplibre-worker] copied worker to public/maplibre-gl-worker.mjs");
}
