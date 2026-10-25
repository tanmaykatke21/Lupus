"use client";

import { useState } from "react";
import type { Place } from "@/lib/places";
import { SAVED_LABELS, type SavedPlace } from "@/lib/storage";
import Icon, { CATEGORY_ICON } from "./Icon";

interface Props {
  places: Place[];
  saved: SavedPlace[];
  onPick: (place: Place) => void;
  /** Shows a Save button on each row that files the place under a label (Dorm, Lab…). */
  onSave?: (place: SavedPlace) => void;
  className?: string;
}

/** Search results: tap a row to pick the place, or Save it as a one-tap chip. */
export default function PlaceResults({ places, saved, onPick, onSave, className = "" }: Props) {
  const [saving, setSaving] = useState<string | null>(null);
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
                  {savedAs ? <span className="block text-xs text-brass">Saved as {savedAs}</span>
                    : p.service ? <span className="block text-xs text-copper">{p.service}</span>
                    : p.aliases[0] && <span className="block truncate text-xs text-muted">{p.aliases.slice(0, 3).join(" · ")}</span>}
                </span>
              </button>
              {onSave && (
                <button onClick={() => setSaving(saving === p.id ? null : p.id)} aria-expanded={saving === p.id}
                  aria-label={`${savedAs ? "Change saved label for" : "Save"} ${p.name}`}
                  className="min-h-12 shrink-0 px-3 text-sm font-semibold text-brass">
                  {savedAs ? "Change" : "Save"}
                </button>
              )}
            </div>
            {onSave && saving === p.id && (
              <div className="flex flex-wrap gap-2 px-3 pb-3" role="group" aria-label={`Save ${p.name} as`}>
                {SAVED_LABELS.map(l => (
                  <button key={l} onClick={() => { onSave({ placeId: p.id, label: l }); setSaving(null); }}
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
  );
}
