"use client";

import { useState } from "react";
import RouteCard from "./RouteCard";
import { placeById } from "@/lib/places";
import type { RouteOption } from "@/lib/router";
import { stepsFor, type Step } from "@/lib/steps";
import { SAVED_LABELS, type SavedLabel } from "@/lib/storage";
import { formatClock } from "@/lib/time";
import type { TripRequest, TripResult } from "@/lib/trip";

const STEP_ICON: Record<Step["icon"], string> = { walk: "🚶", wait: "⏳", bus: "🚌", arrive: "🏁", shortcut: "🚪" };

interface Props {
  originName: string;
  request: TripRequest;
  result: TripResult | null;
  error: { message: string; offMap: boolean } | null;
  loading: boolean;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChangeOrigin: () => void;
  onChangeDestination: () => void;
  onClose: () => void;
  isSaved: boolean;
  onSave: (label: SavedLabel) => void;
  onUnsave: () => void;
  onStart?: (option: RouteOption) => void;
}

export default function ResultsPanel(p: Props) {
  const [labeling, setLabeling] = useState(false);
  const options = p.result?.options ?? [];
  const selected = options.find(o => o.id === p.selectedId) ?? options[0];

  return (
    <div>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <button onClick={p.onChangeOrigin} className="block min-h-9 max-w-full truncate text-left text-muted">
            From <span className="font-medium text-ink underline decoration-dotted">{p.originName}</span>
          </button>
          <button onClick={p.onChangeDestination} className="block min-h-9 max-w-full truncate text-left font-display text-lg font-bold">
            {p.request.to.name}
          </button>
          {p.request.arriveBy && (
            <p className="text-sm text-copper">
              Arrive by {formatClock(p.request.arriveBy)}{p.request.context ? ` for ${p.request.context}` : ""}
            </p>
          )}
        </div>
        <button onClick={p.onClose} className="h-11 rounded-xl border border-line px-4 text-sm font-medium">Close</button>
      </div>

      {p.request.to.placeId && placeById(p.request.to.placeId)?.service && !options.some(o => o.kind === "bus") && p.result && (
        <p role="status" className="mb-2 rounded-xl bg-brass/15 px-3 py-2 text-sm">
          🚌 {placeById(p.request.to.placeId)!.service}. Check back when it&apos;s running.
        </p>
      )}
      {p.result?.warnings.map(w => (
        <p key={w} role="status" className="mb-2 rounded-xl bg-warn/15 px-3 py-2 text-sm">{w}</p>
      ))}
      {p.error && (
        <div role="alert" className="mb-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {p.error.offMap ? "Your location looks off campus. Pick a starting point instead." : p.error.message}
          {p.error.offMap && (
            <button onClick={p.onChangeOrigin} className="ml-2 font-semibold underline">Choose start</button>
          )}
        </div>
      )}
      {p.loading && !p.result && (
        <div className="space-y-2" aria-label="Finding routes" role="status">
          {[0, 1].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-2" />)}
        </div>
      )}

      <div className="space-y-2">
        {options.map((o, i) => (
          <RouteCard key={o.id} option={o} now={p.now} fastest={i === 0 && options.length > 1}
            selected={o.id === selected?.id} onSelect={() => p.onSelect(o.id)} />
        ))}
      </div>

      {selected && (
        <section className="mt-4" aria-labelledby="steps-title">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="steps-title" className="font-display text-sm font-bold uppercase tracking-widest text-muted">Steps</h3>
            {p.onStart && (
              <button onClick={() => p.onStart!(selected)} className="btn-brass h-11 rounded-xl px-4 text-sm font-bold">
                ▶ Start navigation
              </button>
            )}
          </div>
          <ol className="space-y-2">
            {stepsFor(selected, p.request.to.name).map((s, i) => (
              <li key={i} className={`flex gap-3 rounded-xl border border-line bg-surface px-3 py-2 ${s.icon === "shortcut" ? "ml-6" : ""}`}>
                <span aria-hidden className="text-lg">{STEP_ICON[s.icon]}</span>
                <span>
                  <span className="block">{s.text}</span>
                  {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.request.to.placeId && (
        <div className="mt-4">
          {p.isSaved ? (
            <button onClick={p.onUnsave} className="min-h-11 rounded-full border border-brass/50 bg-brass/10 px-4 text-sm font-medium">★ Saved · remove</button>
          ) : labeling ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Save as">
              {SAVED_LABELS.map(l => (
                <button key={l} onClick={() => { p.onSave(l); setLabeling(false); }}
                  className="min-h-11 rounded-full border border-line bg-surface px-3 text-sm">{l}</button>
              ))}
            </div>
          ) : (
            <button onClick={() => setLabeling(true)} className="min-h-11 rounded-full border border-line px-4 text-sm font-medium">☆ Save this place</button>
          )}
        </div>
      )}
    </div>
  );
}
