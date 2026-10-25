"use client";

import { useEffect, useState } from "react";
import type { LirrTrain } from "@/lib/lirr";
import { PLACES, placeById, searchPlaces } from "@/lib/places";
import { SAVED_LABELS, type SavedPlace } from "@/lib/storage";
import { formatClock } from "@/lib/time";
import { catchTrainRequest, type Endpoint, type TripRequest } from "@/lib/trip";
import { countdown } from "@/lib/useNow";

interface Props {
  now: number;
  bufferMin: number;
  saved: SavedPlace[];
  onPlan: (req: TripRequest) => void;
  onSave: (place: SavedPlace) => void;
}

interface Feed {
  station: { name: string; lat: number; lng: number };
  trains: LirrTrain[];
  realtime: boolean;
  scheduleValidTo: string;
}

type Mode = "catch" | "back";

const HOME_CHOICES = ["sac", "hospital", "chapin", "west-apts"];

export default function TrainsPanel({ now, bufferMin, saved, onPlan, onSave }: Props) {
  const [mode, setMode] = useState<Mode>("catch");
  const [direction, setDirection] = useState<"west" | "east">("west");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arriving, setArriving] = useState<LirrTrain | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const q = mode === "catch" ? `kind=departures&direction=${direction}` : "kind=arrivals&direction=east";
    const load = () => fetch(`/api/lirr/departures?${q}&limit=8`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "LIRR data unavailable");
        if (!stopped) { setFeed(body); setError(null); }
      })
      .catch(err => !stopped && setError(err.message));
    load();
    const id = setInterval(load, 30_000);
    return () => { stopped = true; clearInterval(id); };
  }, [mode, direction]);

  const station: Endpoint | null = feed ? { name: "Stony Brook LIRR Station", lat: feed.station.lat, lng: feed.station.lng, placeId: "lirr" } : null;

  const catchTrain = (t: LirrTrain) => onPlan(catchTrainRequest(t, bufferMin));

  const goHome = (t: LirrTrain, placeId: string) => {
    const p = placeById(placeId);
    if (!p || !station) return;
    onPlan({
      from: station,
      to: { name: p.name, lng: p.lng, lat: p.lat, placeId: p.id },
      departAt: t.expected + 2 * 60_000, // off the train and down the platform
      context: undefined,
    });
  };

  const choices = [
    ...saved.map(s => ({ id: s.placeId, label: s.label })),
    ...HOME_CHOICES.filter(id => !saved.some(s => s.placeId === id)).map(id => ({ id, label: placeById(id)?.name ?? id })),
  ].filter(c => PLACES.some(p => p.id === c.id));
  const results = q.trim() ? searchPlaces(q).slice(0, 6) : [];
  const leaveArriving = () => { setArriving(null); setQ(""); setSaving(null); };

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Train mode">
        {(["catch", "back"] as Mode[]).map(m => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); leaveArriving(); }}
            className={`min-h-11 rounded-lg text-sm font-semibold ${mode === m ? "plate" : "text-muted"}`}>
            {m === "catch" ? "Catch a train" : "Coming back"}
          </button>
        ))}
      </div>

      {mode === "catch" && (
        <div className="mb-3 flex gap-2" role="group" aria-label="Direction">
          {(["west", "east"] as const).map(d => (
            <button key={d} onClick={() => setDirection(d)} aria-pressed={direction === d}
              className={`min-h-11 flex-1 rounded-full border text-sm font-medium ${direction === d ? "border-brass bg-brass/20" : "border-line"}`}>
              {d === "west" ? "To NYC ←" : "To Port Jefferson →"}
            </button>
          ))}
        </div>
      )}

      {feed && !feed.realtime && (
        <p role="status" className="mb-2 rounded-xl bg-warn/15 px-3 py-2 text-sm">Schedule only: live LIRR updates are unavailable right now.</p>
      )}
      {error && <p role="alert" className="mb-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {!feed && !error && <div className="h-40 animate-pulse rounded-2xl bg-surface-2" role="status" aria-label="Loading trains" />}

      {arriving ? (
        <div className="plate rounded-2xl p-3">
          <p className="text-sm text-muted">Arriving {formatClock(arriving.expected)} {arriving.destination}</p>
          <h3 className="mb-2 font-display text-lg font-bold">Where are you headed?</h3>
          <div className="flex flex-wrap gap-2">
            {choices.map(c => (
              <button key={c.id} onClick={() => goHome(arriving, c.id)} className="min-h-11 rounded-full card px-3 text-sm font-medium">
                {c.label}
              </button>
            ))}
          </div>

          <label htmlFor="train-dest" className="sr-only">Search for somewhere else</label>
          <input
            id="train-dest"
            value={q}
            onChange={e => { setQ(e.target.value); setSaving(null); }}
            placeholder="Somewhere else? Search campus"
            autoComplete="off"
            enterKeyHint="search"
            onKeyDown={e => { if (e.key === "Enter" && results[0]) goHome(arriving, results[0].id); }}
            className="mt-3 h-12 w-full card rounded-2xl px-4 text-base placeholder:text-muted"
          />
          {results.length > 0 && (
            <ul className="mt-2 divide-y divide-line overflow-hidden card rounded-2xl" aria-live="polite">
              {results.map(p => {
                const savedAs = saved.find(s => s.placeId === p.id)?.label;
                return (
                  <li key={p.id}>
                    <div className="flex items-center">
                      <button onClick={() => goHome(arriving, p.id)} className="min-h-12 min-w-0 flex-1 px-3 py-2 text-left">
                        <span className="block truncate font-medium">{p.name}</span>
                        {savedAs && <span className="block text-xs text-muted">Saved as {savedAs}</span>}
                      </button>
                      <button onClick={() => setSaving(saving === p.id ? null : p.id)} aria-expanded={saving === p.id}
                        className="min-h-12 shrink-0 px-3 text-sm font-semibold text-brass">
                        {savedAs ? "Change" : "Save"}
                      </button>
                    </div>
                    {saving === p.id && (
                      <div className="flex flex-wrap gap-2 px-3 pb-3" role="group" aria-label={`Save ${p.name} as`}>
                        {SAVED_LABELS.map(l => (
                          <button key={l} onClick={() => { onSave({ placeId: p.id, label: l }); setSaving(null); setQ(""); }}
                            aria-pressed={savedAs === l}
                            className={`min-h-11 rounded-full border px-3 text-sm font-medium ${savedAs === l ? "border-brass bg-brass/20" : "border-line"}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {q.trim() && results.length === 0 && <p className="mt-2 text-sm text-muted">No campus places match “{q}”.</p>}

          <button onClick={leaveArriving} className="mt-3 min-h-11 text-sm text-muted underline">Back to trains</button>
        </div>
      ) : (
        <ul className="space-y-2">
          {feed?.trains.map(t => {
            const until = t.expected - now;
            return (
              <li key={t.key}>
                <button
                  disabled={t.canceled}
                  onClick={() => (mode === "catch" ? catchTrain(t) : setArriving(t))}
                  className="flex min-h-14 w-full items-center gap-3 card rounded-2xl px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="w-1.5 self-stretch rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={`block font-display text-lg font-bold tabular-nums ${t.canceled ? "line-through" : ""}`}>
                      {formatClock(t.expected)}
                    </span>
                    <span className="block truncate text-sm">{t.destination}</span>
                    <span className="block text-xs text-muted">
                      Train {t.train}
                      {t.stations.penn && mode === "catch" && t.direction === "west" ? ` · Penn ${formatClock(t.stations.penn)}` : ""}
                      {t.stations.grandCentral && mode === "catch" && t.direction === "west" ? ` · GCT ${formatClock(t.stations.grandCentral)}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    {t.canceled ? <span className="font-bold text-danger">Canceled</span>
                      : t.delayMin === null ? <span className="text-muted">Scheduled</span>
                      : t.delayMin > 0 ? <span className="font-semibold text-warn">{t.delayMin} min late</span>
                      : <span className="font-semibold text-ok">On time</span>}
                    <span className="block text-xs text-muted">{until > 0 ? `in ${countdown(until)}` : "now"}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {feed && feed.trains.length === 0 && <li className="text-sm text-muted">No trains in the next few hours.</li>}
        </ul>
      )}
      {feed && (
        <p className="mt-3 text-xs text-muted">
          {mode === "catch" ? `Tap a train to get there with ${bufferMin} min to spare (change in settings).` : "Tap your train to plan the trip from the station."}
          {" "}Schedule valid through {feed.scheduleValidTo.slice(4, 6)}/{feed.scheduleValidTo.slice(6)}. Track numbers aren&apos;t in MTA&apos;s open feed.
        </p>
      )}
    </div>
  );
}
