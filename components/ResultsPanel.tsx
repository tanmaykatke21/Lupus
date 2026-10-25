"use client";

import { useState } from "react";
import RouteCard from "./RouteCard";
import Icon, { STEP_ICON } from "./Icon";
import { placeById, type Place } from "@/lib/places";
import type { RouteOption } from "@/lib/router";
import { stepsFor } from "@/lib/steps";
import type { SavedPlace } from "@/lib/storage";
import { SaveEditor, SavedChips, StarButton } from "./PlaceResults";
import { formatClock } from "@/lib/time";
import type { TripRequest, TripResult } from "@/lib/trip";


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
  saved: SavedPlace[];
  onSave: (label: string) => void;
  onUnsave: () => void;
  /** Quick start: a saved place, or null for "my location". */
  onPickOrigin: (place: Place | null) => void;
  originIsMe: boolean;
  onStart?: (option: RouteOption) => void;
}

type Filter = "best" | "bus" | "walk";

export default function ResultsPanel(p: Props) {
  const [naming, setNaming] = useState(false);
  const toId = p.request.to.placeId;
  const savedLabel = p.saved.find(s => s.placeId === toId)?.label;
  const [filter, setFilter] = useState<Filter>("best");
  const all = p.result?.options ?? [];
  // Best: our ranking (no slower-than-walk bus). Bus: fastest bus even if walking wins. Walk: walk only.
  const options = all.filter(o => (filter === "best" ? !o.slowerThanWalk : o.kind === filter));
  const selected = options.find(o => o.id === p.selectedId) ?? options[0];
  const pickFilter = (f: Filter) => {
    setFilter(f);
    const first = all.find(o => (f === "best" ? !o.slowerThanWalk : o.kind === f));
    if (first) p.onSelect(first.id);
  };

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
        {toId && (
          <StarButton saved={!!savedLabel} name={p.request.to.name} className="grid h-11 w-11 place-items-center rounded-full btn-glass"
            onClick={() => { if (!savedLabel) p.onSave(p.request.to.name); setNaming(n => !n); }} />
        )}
        <button onClick={p.onClose} className="h-11 rounded-full btn-glass px-4 text-sm font-medium">Close</button>
      </div>
      {naming && savedLabel && (
        <SaveEditor placeName={p.request.to.name} label={savedLabel} className="mb-3 card rounded-2xl p-3"
          onRename={p.onSave} onRemove={() => { p.onUnsave(); setNaming(false); }} onDone={() => setNaming(false)} />
      )}
      {!p.request.from && (
        <SavedChips saved={p.saved} exclude={toId} onPick={p.onPickOrigin} label="Start from" className="mb-3"
          leading={
            <button onClick={() => p.onPickOrigin(null)} aria-pressed={p.originIsMe}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${p.originIsMe ? "bg-brass text-white" : "bg-surface-2"}`}>
              <Icon name="location" className="h-3.5 w-3.5" />My location
            </button>
          } />
      )}

      {p.request.to.placeId && placeById(p.request.to.placeId)?.service && !options.some(o => o.kind === "bus") && p.result && (
        <p role="status" className="mb-2 rounded-xl bg-brass/15 px-3 py-2 text-sm">
          {placeById(p.request.to.placeId)!.service}. Check back when it&apos;s running.
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

      {all.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Show">
          {(["best", "bus", "walk"] as const).map(f => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => pickFilter(f)}
              className={`min-h-10 rounded-lg text-sm font-semibold capitalize ${filter === f ? "plate" : "text-muted"}`}>
              {f}
            </button>
          ))}
        </div>
      )}
      {filter === "bus" && all.length > 0 && !options.length && (
        <p role="status" className="mb-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">No bus gets you there right now.</p>
      )}
      {filter === "bus" && options.some(o => o.slowerThanWalk) && (
        <p role="status" className="mb-2 text-sm text-muted">Walking is faster right now, but here&apos;s the quickest bus.</p>
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
            <h3 id="steps-title" className="font-display text-sm font-bold uppercase tracking-wide text-muted">Steps</h3>
            {p.onStart && (
              <button onClick={() => p.onStart!(selected)} className="btn-brass h-11 rounded-full px-4 text-sm font-bold">
                Start navigation
              </button>
            )}
          </div>
          <ol className="space-y-2">
            {stepsFor(selected, p.request.to.name).map((s, i) => (
              <li key={i} className={`flex gap-3 card rounded-2xl px-3 py-2 ${s.icon === "shortcut" ? "ml-6" : ""}`}>
                <Icon name={STEP_ICON[s.icon]} className="mt-0.5 h-5 w-5 text-muted" />
                <span>
                  <span className="block">{s.text}</span>
                  {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

    </div>
  );
}
