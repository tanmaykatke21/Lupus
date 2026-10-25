"use client";

import { useState, type ReactNode } from "react";
import { PLACES, type Place } from "@/lib/places";
import { SAVED_LABELS, type SavedPlace } from "@/lib/storage";
import Icon, { CATEGORY_ICON } from "./Icon";

interface ResultsProps {
  places: Place[];
  saved: SavedPlace[];
  onPick: (place: Place) => void;
  /** Shows a star on each row: tap to save the place, then name it. */
  onSave?: (place: SavedPlace) => void;
  onUnsave?: (placeId: string) => void;
  className?: string;
}

/** Search results: tap a row to pick the place, or star it to keep it as a one-tap chip. */
export default function PlaceResults({ places, saved, onPick, onSave, onUnsave, className = "" }: ResultsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!places.length) return null;

  return (
    <ul className={`divide-y divide-line overflow-hidden card rounded-2xl ${className}`} aria-live="polite">
      {places.map(p => {
        const savedAs = saved.find(s => s.placeId === p.id)?.label;
        return (
          <li key={p.id}>
            <div className="flex items-center">
              <button onClick={() => onPick(p)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
                <Icon name={CATEGORY_ICON[p.category]} className="h-5 w-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  {savedAs && savedAs !== p.name ? <span className="block text-xs text-brass">Saved as {savedAs}</span>
                    : p.service ? <span className="block text-xs text-copper">{p.service}</span>
                    : p.aliases[0] && <span className="block truncate text-xs text-muted">{p.aliases.slice(0, 3).join(" · ")}</span>}
                </span>
              </button>
              {onSave && (
                <StarButton saved={!!savedAs} name={p.name} onClick={() => {
                  if (!savedAs) onSave({ placeId: p.id, label: p.name });
                  setEditing(editing === p.id ? null : p.id);
                }} />
              )}
            </div>
            {onSave && savedAs && editing === p.id && (
              <SaveEditor placeName={p.name} label={savedAs} className="px-3 pb-3"
                onRename={label => onSave({ placeId: p.id, label })}
                onRemove={() => { onUnsave?.(p.id); setEditing(null); }}
                onDone={() => setEditing(null)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function StarButton({ saved, name, onClick, className = "min-h-12 px-3" }: { saved: boolean; name: string; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} aria-pressed={saved} aria-label={saved ? `Edit saved place ${name}` : `Save ${name}`}
      className={`shrink-0 ${saved ? "text-brass" : "text-muted"} ${className}`}>
      <Icon name="star" className={`h-6 w-6 ${saved ? "fill-current" : ""}`} />
    </button>
  );
}

interface EditorProps {
  placeName: string;
  label: string;
  onRename: (label: string) => void;
  onRemove: () => void;
  onDone: () => void;
  className?: string;
}

/** Shown right after starring a place: give it a short name (Dorm, Lab, or your own) or unsave it. */
export function SaveEditor({ placeName, label, onRename, onRemove, onDone, className = "" }: EditorProps) {
  const [draft, setDraft] = useState(label);
  const commit = (name: string) => { const n = name.trim(); if (n) onRename(n.slice(0, 24)); onDone(); };
  const names = [...new Set([placeName, ...SAVED_LABELS])];

  return (
    <div className={className}>
      <p className="mb-2 text-xs text-muted">Saved. What should the chip say?</p>
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label={`Name for ${placeName}`}>
        {names.map(n => (
          <button key={n} onClick={() => commit(n)} aria-pressed={label === n}
            className={`min-h-10 rounded-full border px-3 text-sm font-medium ${label === n ? "border-brass bg-brass/20" : "border-line"}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`save-name-${placeName}`} className="sr-only">Custom name</label>
        <input id={`save-name-${placeName}`} value={draft} maxLength={24} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") commit(draft); }}
          placeholder="Your own name, e.g. My dorm" enterKeyHint="done"
          className="h-11 min-w-0 flex-1 rounded-xl bg-surface-2 px-3 text-base placeholder:text-muted" />
        <button onClick={() => commit(draft)} className="h-11 rounded-full btn-brass px-4 text-sm font-semibold">Done</button>
      </div>
      <button onClick={onRemove} className="mt-2 min-h-10 text-sm text-danger">Remove from saved</button>
    </div>
  );
}

interface ChipsProps {
  saved: SavedPlace[];
  onPick: (place: Place) => void;
  /** Leave out a place (e.g. the trip's destination when picking a start). */
  exclude?: string;
  /** Chips that come before the saved ones, e.g. "My location". */
  leading?: ReactNode;
  label?: string;
  className?: string;
}

/** Saved places as one-tap chips. Renders nothing when there's nothing to show. */
export function SavedChips({ saved, onPick, exclude, leading, label = "Saved places", className = "" }: ChipsProps) {
  const items = saved.flatMap(s => {
    const p = s.placeId !== exclude && PLACES.find(x => x.id === s.placeId);
    return p ? [{ s, p }] : [];
  });
  if (!items.length && !leading) return null;
  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 ${className}`} role="group" aria-label={label}>
      {leading}
      {items.map(({ s, p }) => (
        <button key={s.placeId} onClick={() => onPick(p)} title={p.name}
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-brass/12 px-3.5 text-sm font-semibold text-brass">
          <Icon name="star" className="h-3.5 w-3.5 fill-current" />{s.label}
        </button>
      ))}
    </div>
  );
}
