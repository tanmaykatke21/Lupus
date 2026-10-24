"use client";

import { useState } from "react";
import { CATEGORY_ICON, PLACES, searchPlaces, type Place } from "@/lib/places";
import type { SavedPlace } from "@/lib/storage";

interface Props {
  title: string;
  saved: SavedPlace[];
  allowMyLocation?: boolean;
  onPick: (place: Place) => void;
  onMyLocation?: () => void;
  onCancel: () => void;
}

const QUICK = ["dining", "dorm", "medical", "transit", "shopping", "town"] as const;

export default function SearchPanel({ title, saved, allowMyLocation, onPick, onMyLocation, onCancel }: Props) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Place["category"] | null>(null);
  const results = q ? searchPlaces(q) : category ? PLACES.filter(p => p.category === category) : [];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="place-search" className="sr-only">{title}</label>
        <input
          id="place-search"
          autoFocus
          value={q}
          onChange={e => { setQ(e.target.value); setCategory(null); }}
          placeholder={title}
          autoComplete="off"
          enterKeyHint="search"
          onKeyDown={e => { if (e.key === "Enter" && results[0]) onPick(results[0]); }}
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base placeholder:text-muted"
        />
        <button onClick={onCancel} className="h-12 rounded-xl px-3 text-sm font-semibold text-muted">Cancel</button>
      </div>

      {allowMyLocation && !q && (
        <button onClick={onMyLocation} className="mb-2 flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left font-medium">
          <span aria-hidden>📍</span> My current location
        </button>
      )}

      {!q && saved.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Saved places">
          {saved.map(s => {
            const p = PLACES.find(x => x.id === s.placeId);
            return p && (
              <button key={s.placeId} onClick={() => onPick(p)} className="min-h-11 rounded-full border border-brass/50 bg-brass/10 px-3 text-sm font-medium">
                ★ {s.label}: {p.name}
              </button>
            );
          })}
        </div>
      )}

      {!q && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Browse by category">
          {QUICK.map(c => (
            <button key={c} onClick={() => setCategory(category === c ? null : c)} aria-pressed={category === c}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium capitalize ${category === c ? "border-brass bg-brass/20" : "border-line bg-surface"}`}>
              {CATEGORY_ICON[c]} {c === "medical" ? "Hospital" : c === "transit" ? "LIRR" : c === "town" ? "Towns" : c}
            </button>
          ))}
        </div>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-live="polite">
        {results.map(p => (
          <li key={p.id}>
            <button onClick={() => onPick(p)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left">
              <span aria-hidden>{CATEGORY_ICON[p.category]}</span>
              <span className="flex-1">
                <span className="block font-medium">{p.name}</span>
                {p.service ? <span className="block text-xs text-copper">🚌 {p.service}</span>
                  : p.aliases[0] && <span className="block text-xs text-muted">{p.aliases.slice(0, 3).join(" · ")}</span>}
              </span>
            </button>
          </li>
        ))}
        {q && results.length === 0 && <li className="p-3 text-sm text-muted">No campus places match “{q}”.</li>}
      </ul>
    </div>
  );
}
