"use client";

// Dev-only campus data editor: add/move places, draw footpaths, add building shortcuts.
// Saves to data/*.json through /api/editor so the changes can be committed for everyone.
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useCallback, useEffect, useRef, useState } from "react";
import graphFile from "@/data/walk-graph.json";
import type { Place, PlaceCategory } from "@/lib/places";
import type { LngLat } from "@/lib/types";
import type { CustomPath, Shortcut, WalkGraphFile } from "@/lib/walk";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
const CATEGORIES: PlaceCategory[] = ["academic", "dorm", "dining", "medical", "transit", "athletics", "services", "parking", "shopping", "town"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// Places the app looks up by id; they can be renamed or moved but not deleted.
const PROTECTED: Record<string, string> = { lirr: "the Trains tab and Ask Lupus use it for LIRR trips" };

type Tool = "select" | "place" | "path" | "shortcut";
type Selected = { kind: "place" | "path" | "shortcut"; id: string } | null;
const ll = ([lng, lat]: LngLat) => ({ lat, lng });
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "item";
const uniqueId = (base: string, taken: Set<string>) => {
  let id = slug(base), n = 2;
  while (taken.has(id)) id = `${slug(base)}-${n++}`;
  return id;
};

let configured = false;

export default function MapEditor() {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const libs = useRef<{ maps: google.maps.MapsLibrary; marker: google.maps.MarkerLibrary } | null>(null);
  const [ready, setReady] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [paths, setPaths] = useState<CustomPath[]>([]);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const [status, setStatus] = useState<string | null>(null);
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; });

  // Load current data from disk (not the bundled copy, which may be stale).
  useEffect(() => {
    fetch("/api/editor").then(async r => {
      const body = await r.json();
      if (!r.ok) { setStatus(body.error); return; }
      setPlaces(body.places); setPaths(body.paths); setShortcuts(body.shortcuts); setLoaded(true);
    }).catch(() => setStatus("Couldn't load data"));
  }, []);

  // Map on satellite with labels, plus the existing OSM footpath network for reference.
  useEffect(() => {
    if (!KEY) return;
    (async () => {
      if (!configured) { setOptions({ key: KEY, v: "weekly" }); configured = true; }
      const [maps, marker] = await Promise.all([importLibrary("maps"), importLibrary("marker")]);
      if (!el.current) return;
      libs.current = { maps, marker };
      const m = new maps.Map(el.current, {
        center: { lat: 40.9125, lng: -73.1235 }, zoom: 17, mapId: MAP_ID, mapTypeId: "hybrid",
        gestureHandling: "greedy", clickableIcons: false, tilt: 0, disableDoubleClickZoom: true,
      });
      map.current = m;
      const g = graphFile as unknown as WalkGraphFile;
      m.data.addGeoJson({
        type: "FeatureCollection",
        features: g.edges.map(([a, b, , flags, flat]) => {
          const mid: LngLat[] = [];
          for (let i = 0; i < flat.length; i += 2) mid.push([flat[i], flat[i + 1]]);
          return { type: "Feature", properties: { stairs: flags & 1 }, geometry: { type: "LineString", coordinates: [g.nodes[a], ...mid, g.nodes[b]] } };
        }),
      });
      m.data.setStyle(f => ({ strokeColor: f.getProperty("stairs") ? "#ff5a6e" : "#4fc3f7", strokeWeight: 2, strokeOpacity: 0.7, clickable: false }));
      m.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng || toolRef.current === "select") return;
        const p: LngLat = [r6(e.latLng.lng()), r6(e.latLng.lat())];
        setDraft(d => (toolRef.current === "place" ? [p] : [...d, p]));
      });
      setReady(true);
    })().catch(() => setStatus("Google Maps failed to load"));
  }, []);

  // Draw places, paths, shortcuts and the draft. Rebuilt on change: simple and fast enough here.
  const drawn = useRef<{ remove: () => void }[]>([]);
  const redraw = useCallback(() => {
    const m = map.current, L = libs.current;
    if (!m || !L) return;
    drawn.current.forEach(d => d.remove());
    drawn.current = [];
    const line = (coords: LngLat[], color: string, weight: number, onClick?: () => void) => {
      const pl = new L.maps.Polyline({ map: m, path: coords.map(ll), strokeColor: color, strokeWeight: weight, clickable: !!onClick, zIndex: 5 });
      if (onClick) pl.addListener("click", onClick);
      drawn.current.push({ remove: () => pl.setMap(null) });
    };
    for (const p of paths) {
      const sel = selected?.kind === "path" && selected.id === p.id;
      line(p.coords, sel ? "#ffffff" : p.stairs ? "#ff5a6e" : "#ff9800", sel ? 7 : 5, () => setSelected({ kind: "path", id: p.id }));
    }
    for (const s of shortcuts) {
      const sel = selected?.kind === "shortcut" && selected.id === s.id;
      line([s.entry, ...(s.path ?? []), s.exit], sel ? "#ffffff" : "#b388ff", sel ? 7 : 5, () => setSelected({ kind: "shortcut", id: s.id }));
    }
    if (draft.length > 1) line(draft, "#ffeb3b", 4);
    for (const p of draft) {
      const dot = document.createElement("div");
      dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:#ffeb3b;border:2px solid #000;transform:translateY(50%)";
      const mk = new L.marker.AdvancedMarkerElement({ map: m, position: ll(p), content: dot, zIndex: 20 });
      drawn.current.push({ remove: () => { mk.map = null; } });
    }
    for (const p of places) {
      const sel = selected?.kind === "place" && selected.id === p.id;
      const pin = document.createElement("div");
      pin.textContent = p.name;
      pin.style.cssText = `font:600 11px system-ui;padding:2px 6px;border-radius:8px;white-space:nowrap;transform:translateY(-4px);` +
        `background:${sel ? "#ffeb3b" : "#fbf6ea"};color:#1d150b;border:2px solid ${sel ? "#000" : "#a8781f"}`;
      const mk = new L.marker.AdvancedMarkerElement({ map: m, position: { lat: p.lat, lng: p.lng }, content: pin, gmpDraggable: true, zIndex: 10, title: p.name });
      mk.addEventListener("gmp-click", () => setSelected({ kind: "place", id: p.id }));
      mk.addListener("dragend", () => {
        const pos = mk.position as google.maps.LatLngLiteral;
        setPlaces(ps => ps.map(x => (x.id === p.id ? { ...x, lat: r6(pos.lat), lng: r6(pos.lng) } : x)));
        setDirty(true);
      });
      drawn.current.push({ remove: () => { mk.map = null; } });
    }
  }, [places, paths, shortcuts, draft, selected]);
  useEffect(() => { if (ready) redraw(); }, [ready, redraw]);

  const allIds = (kind: "place" | "path" | "shortcut") =>
    new Set((kind === "place" ? places : kind === "path" ? paths : shortcuts).map(x => x.id));

  // --- forms ---
  const [form, setForm] = useState({ name: "", category: "academic" as PlaceCategory, aliases: "", stairs: false, accessible: true,
    weekday: ["07:00", "23:00"], sat: ["09:00", "22:00"], sun: ["09:00", "22:00"], satClosed: false, sunClosed: false, note: "" });
  const resetDraft = () => { setDraft([]); setForm(f => ({ ...f, name: "", aliases: "", note: "" })); };

  const commitDraft = () => {
    if (tool === "place" && draft.length === 1 && form.name.trim()) {
      const p: Place = { id: uniqueId(form.name, allIds("place")), name: form.name.trim(), category: form.category,
        aliases: form.aliases.split(",").map(a => a.trim()).filter(Boolean), lng: draft[0][0], lat: draft[0][1] };
      setPlaces(ps => [...ps, p]);
    } else if (tool === "path" && draft.length >= 2) {
      setPaths(ps => [...ps, { id: uniqueId(form.name || "path", allIds("path")), ...(form.name.trim() && { name: form.name.trim() }), coords: draft, stairs: form.stairs }]);
    } else if (tool === "shortcut" && draft.length >= 2 && form.name.trim()) {
      const hours: Shortcut["hours"] = {};
      for (const d of DAYS) {
        hours[d] = d === "sat" ? (form.satClosed ? null : [form.sat[0], form.sat[1]])
          : d === "sun" ? (form.sunClosed ? null : [form.sun[0], form.sun[1]])
          : [form.weekday[0], form.weekday[1]];
      }
      setShortcuts(ss => [...ss, {
        id: uniqueId(form.name, allIds("shortcut")), name: form.name.trim(), accessible: form.accessible,
        ...(form.note.trim() && { note: form.note.trim() }),
        entry: draft[0], exit: draft[draft.length - 1], ...(draft.length > 2 && { path: draft.slice(1, -1) }), hours,
      }]);
    } else return;
    setDirty(true);
    resetDraft();
  };

  const updatePlace = (id: string, patch: Partial<Place>) => {
    setPlaces(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  const deleteSelected = () => {
    if (!selected || (selected.kind === "place" && PROTECTED[selected.id])) return;
    if (selected.kind === "place") setPlaces(ps => ps.filter(p => p.id !== selected.id));
    if (selected.kind === "path") setPaths(ps => ps.filter(p => p.id !== selected.id));
    if (selected.kind === "shortcut") setShortcuts(ss => ss.filter(s => s.id !== selected.id));
    setSelected(null);
    setDirty(true);
  };

  const save = async () => {
    setStatus("Saving…");
    const res = await fetch("/api/editor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ places, paths, shortcuts }) });
    const body = await res.json();
    if (!res.ok) { setStatus(`Not saved: ${body.error}`); return; }
    setDirty(false);
    setStatus(`Saved ${body.written.join(", ")}. Routing picks it up on reload. Commit these files to share them.`);
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!KEY) return <p className="p-6">The editor uses Google satellite imagery: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local.</p>;

  const sel = selected && (selected.kind === "place" ? places.find(p => p.id === selected.id)
    : selected.kind === "path" ? paths.find(p => p.id === selected.id) : shortcuts.find(s => s.id === selected.id));
  const hint: Record<Tool, string> = {
    select: "Tap a path, shortcut or label to select it. Drag labels to move places.",
    place: "Tap where the place is (its main entrance is best), then name it.",
    path: "Tap along the walkway, point by point. Start and end on (or near) an existing blue path.",
    shortcut: "Tap the entrance, any turns inside, then the exit. Then set its hours.",
  };
  const canAdd = tool === "place" ? draft.length === 1 && !!form.name.trim()
    : tool === "path" ? draft.length >= 2 : tool === "shortcut" ? draft.length >= 2 && !!form.name.trim() : false;

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <div ref={el} className="min-h-[55vh] flex-1" />
      <aside className="w-full space-y-3 overflow-y-auto bg-surface p-4 text-sm md:w-96">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold">Campus editor</h1>
          <button onClick={save} disabled={!dirty || !loaded} className="btn-brass h-10 rounded-xl px-4 font-bold disabled:opacity-40">
            {dirty ? "Save" : "Saved"}
          </button>
        </div>
        {status && <p role="status" className="rounded-lg bg-surface-2 p-2">{status}</p>}
        <p className="text-xs text-muted">
          {places.length} places · {paths.length} drawn paths · {shortcuts.length} shortcuts.
          Blue = existing footpaths (red = stairs), orange = your paths, purple = shortcuts.
        </p>

        <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Tool">
          {(["select", "place", "path", "shortcut"] as Tool[]).map(t => (
            <button key={t} role="tab" aria-selected={tool === t} onClick={() => { setTool(t); resetDraft(); setSelected(null); }}
              className={`h-10 rounded-lg font-semibold capitalize ${tool === t ? "plate" : "text-muted"}`}>{t}</button>
          ))}
        </div>
        <p className="text-muted">{hint[tool]}</p>

        {tool !== "select" && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="font-semibold">{draft.length} point{draft.length === 1 ? "" : "s"}</p>
            {(tool === "place" || tool === "shortcut" || tool === "path") && (
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={tool === "path" ? "Name (optional), e.g. path behind Frey" : "Name"} className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2" />
            )}
            {tool === "place" && (
              <>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as PlaceCategory })}
                  className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })}
                  placeholder="Nicknames, comma separated" className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2" />
              </>
            )}
            {tool === "path" && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.stairs} onChange={e => setForm({ ...form, stairs: e.target.checked })} /> Has stairs</label>
            )}
            {tool === "shortcut" && (
              <>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Tip, e.g. 2nd floor bridge"
                  className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2" />
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.accessible} onChange={e => setForm({ ...form, accessible: e.target.checked })} /> Step-free (ramp or elevator)</label>
                {([["Mon–Fri", "weekday", null], ["Sat", "sat", "satClosed"], ["Sun", "sun", "sunClosed"]] as const).map(([label, key, closedKey]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-16">{label}</span>
                    <input type="time" value={form[key][0]} disabled={!!closedKey && form[closedKey]} onChange={e => setForm({ ...form, [key]: [e.target.value, form[key][1]] })} className="rounded border border-line bg-surface-2 px-1" />
                    <span>–</span>
                    <input type="time" value={form[key][1] === "24:00" ? "23:59" : form[key][1]} disabled={!!closedKey && form[closedKey]}
                      onChange={e => setForm({ ...form, [key]: [form[key][0], e.target.value === "23:59" ? "24:00" : e.target.value] })} className="rounded border border-line bg-surface-2 px-1" />
                    {closedKey && <label className="flex items-center gap-1"><input type="checkbox" checked={form[closedKey]} onChange={e => setForm({ ...form, [closedKey]: e.target.checked })} />closed</label>}
                  </div>
                ))}
              </>
            )}
            <div className="flex gap-2">
              <button onClick={commitDraft} disabled={!canAdd} className="btn-brass h-10 flex-1 rounded-lg font-bold disabled:opacity-40">Add</button>
              {tool !== "place" && <button onClick={() => setDraft(d => d.slice(0, -1))} disabled={!draft.length} className="h-10 rounded-lg border border-line px-3 disabled:opacity-40">Undo point</button>}
              <button onClick={resetDraft} className="h-10 rounded-lg border border-line px-3">Clear</button>
            </div>
          </div>
        )}

        {sel && (
          <div className="space-y-2 rounded-xl border border-brass p-3">
            <p className="font-semibold">Selected {selected!.kind}: {"name" in sel && sel.name ? sel.name : sel.id}</p>
            {selected!.kind === "place" && "category" in sel && (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs text-muted">Name (renaming keeps saved places and classes linked)</span>
                  <input value={sel.name} onChange={e => updatePlace(sel.id, { name: e.target.value })}
                    className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2" />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Category</span>
                  <select value={sel.category} onChange={e => updatePlace(sel.id, { category: e.target.value as PlaceCategory })}
                    className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Nicknames (comma separated)</span>
                  <input defaultValue={sel.aliases.join(", ")} key={sel.id}
                    onBlur={e => updatePlace(sel.id, { aliases: e.target.value.split(",").map(a => a.trim()).filter(Boolean) })}
                    className="h-10 w-full rounded-lg border border-line bg-surface-2 px-2" />
                </label>
                <p className="text-xs text-muted">Drag its label on the map to move it.</p>
              </div>
            )}
            {selected!.kind === "place" && PROTECTED[selected!.id] ? (
              <p className="text-xs text-warn">Can&apos;t delete: {PROTECTED[selected!.id]}. Rename or move it instead.</p>
            ) : (
              <button onClick={deleteSelected} className="h-10 w-full rounded-lg border border-danger font-semibold text-danger">Delete</button>
            )}
          </div>
        )}
        <p className="text-xs text-muted">Changes stay in this page until you Save. Saving writes data/places.json, data/custom-paths.json and data/shortcuts.json.</p>
      </aside>
    </main>
  );
}
