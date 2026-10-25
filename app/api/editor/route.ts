// Dev-only: lets /editor read and write the campus data files. Disabled in production builds.
import { readFile, writeFile } from "node:fs/promises";
import { connection } from "next/server";
import { formatJson } from "@/lib/formatJson";
import { CACHE, json } from "@/lib/http";

const FILES = {
  places: "data/places.json",
  paths: "data/custom-paths.json",
  shortcuts: "data/shortcuts.json",
} as const;
const KEYS = { places: "places", paths: "paths", shortcuts: "shortcuts" } as const;

// Literal paths (not FILES[k]) so the bundler traces only these three files, not the whole project.
function read(k: keyof typeof FILES) {
  if (k === "places") return readFile("data/places.json", "utf8");
  if (k === "paths") return readFile("data/custom-paths.json", "utf8");
  return readFile("data/shortcuts.json", "utf8");
}
function write(k: keyof typeof FILES, text: string) {
  if (k === "places") return writeFile("data/places.json", text);
  if (k === "paths") return writeFile("data/custom-paths.json", text);
  return writeFile("data/shortcuts.json", text);
}
const CATEGORIES = ["academic", "dorm", "dining", "medical", "transit", "athletics", "services", "parking", "shopping", "town"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const devOnly = () =>
  process.env.NODE_ENV === "production" ? json({ error: "The editor only works in development (npm run dev)." }, CACHE.none, 403) : null;

const isCoord = (c: unknown): c is [number, number] =>
  Array.isArray(c) && c.length === 2 && c.every(n => typeof n === "number" && Number.isFinite(n)) &&
  c[0] > -73.3 && c[0] < -72.9 && c[1] > 40.8 && c[1] < 41.0; // Stony Brook area only
const isTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-4]):[0-5]\d$/.test(t);
const str = (v: unknown, max = 80) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function validPlace(p: Record<string, unknown>) {
  return str(p.id, 40) && /^[a-z0-9-]+$/.test(p.id as string) && str(p.name) && CATEGORIES.includes(p.category as string) &&
    Array.isArray(p.aliases) && p.aliases.every(a => str(a, 60)) && isCoord([p.lng, p.lat]);
}
function validPath(p: Record<string, unknown>) {
  return str(p.id, 40) && Array.isArray(p.coords) && p.coords.length >= 2 && p.coords.length <= 500 &&
    p.coords.every(isCoord) && typeof p.stairs === "boolean";
}
function validShortcut(s: Record<string, unknown>) {
  const hours = s.hours as Record<string, unknown> | undefined;
  return str(s.id, 40) && str(s.name) && typeof s.accessible === "boolean" && isCoord(s.entry) && isCoord(s.exit) &&
    (s.path === undefined || (Array.isArray(s.path) && s.path.every(isCoord))) &&
    !!hours && Object.entries(hours).every(([d, h]) => DAYS.includes(d) && (h === null || (Array.isArray(h) && h.length === 2 && h.every(isTime))));
}

export async function GET() {
  await connection();
  const blocked = devOnly();
  if (blocked) return blocked;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(FILES) as (keyof typeof FILES)[]) out[k] = JSON.parse(await read(k))[KEYS[k]];
  return json(out, CACHE.none);
}

// POST { places?, paths?, shortcuts? } replaces those lists (other fields in each file are kept).
export async function POST(request: Request) {
  await connection();
  const blocked = devOnly();
  if (blocked) return blocked;
  const body = await request.json().catch(() => null) as Record<string, Record<string, unknown>[]> | null;
  if (!body) return json({ error: "Send JSON" }, CACHE.none, 400);
  const checks = { places: validPlace, paths: validPath, shortcuts: validShortcut };
  const written: string[] = [];
  for (const k of Object.keys(FILES) as (keyof typeof FILES)[]) {
    const list = body[k];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return json({ error: `${k} must be a list` }, CACHE.none, 400);
    const bad = list.findIndex(item => !checks[k](item));
    if (bad !== -1) return json({ error: `${k}[${bad}] is invalid: ${JSON.stringify(list[bad]).slice(0, 160)}` }, CACHE.none, 400);
    const ids = new Set(list.map(i => i.id));
    if (ids.size !== list.length) return json({ error: `${k} has duplicate ids` }, CACHE.none, 400);
    // The app looks the station up by id (trains, Ask Lupus): it can be renamed or moved, not removed.
    if (k === "places" && !ids.has("lirr")) return json({ error: "The LIRR station place can't be deleted." }, CACHE.none, 400);
    const text = await read(k);
    const file = JSON.parse(text);
    file[KEYS[k]] = list;
    // Keep the file's indentation, and short arrays like [lng, lat] on one line, so diffs stay small.
    const indent = /\n( +)"/.exec(text)?.[1].length ?? 2;
    await write(k, formatJson(file, indent));
    written.push(FILES[k]);
  }
  return json({ written }, CACHE.none);
}
