// MapLibre v6 resolves its worker relative to the bundle, which Next doesn't serve.
// Copy it into public/ so the client can point setWorkerUrl at /maplibre-gl-worker.mjs.
import { copyFileSync } from "node:fs";

copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
