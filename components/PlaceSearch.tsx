"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/places";
import { searchPlaces, type SearchHit } from "@/lib/search";

const RECENT_KEY = "lupus.recentDestinations";
const RECENT_MAX = 3;

function readRecent(places: Place[]): Place[] {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    return ids.map((id) => places.find((p) => p.id === id)).filter((p): p is Place => Boolean(p));
  } catch {
    return [];
  }
}

function saveRecent(place: Place) {
  try {
    const previous = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    const ids = [place.id, ...previous.filter((id) => id !== place.id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Private browsing or storage disabled: recents are a convenience, so skip them.
  }
}

interface Props {
  /** Places and bus stops to search. */
  places: Place[];
  value: Place | null;
  onChoose: (place: Place | null) => void;
  /** Called when the list of suggestions opens or closes, so the sheet can make room. */
  onOpenChange?: (open: boolean) => void;
  /** Shown above the chosen place, e.g. "Going to" or "Starting from". */
  chosenLabel?: string;
  /** Accessible name of the search box. */
  searchLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Icon for the chosen place: the destination pin or the trip-start ring. */
  variant?: "destination" | "start";
}

export default function PlaceSearch({
  places,
  value,
  onChoose,
  onOpenChange,
  chosenLabel = "Going to",
  searchLabel = "Where to?",
  placeholder = "Where to? Try Javits or SAC",
  autoFocus = false,
  variant = "destination",
}: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Place[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const hits: SearchHit[] = useMemo(() => searchPlaces(places, query), [places, query]);
  const options: { place: Place; note?: string }[] = query.trim()
    ? hits.map((h) => ({
        place: h.place,
        note: h.matched !== h.place.name ? `Matches "${h.matched}"` : undefined,
      }))
    : recent.map((p) => ({ place: p, note: "Recent" }));
  const open = focused && (options.length > 0 || query.trim().length > 0);

  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  const choose = (place: Place) => {
    saveRecent(place);
    onChoose(place);
    setQuery("");
    setFocused(false);
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && options[active]) {
      e.preventDefault();
      choose(options[active].place);
    } else if (e.key === "Escape") {
      setQuery("");
      input.current?.blur();
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
        {variant === "start" ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-concrete" aria-hidden="true">
            <span className="size-3 rounded-full border-2 border-white bg-navy shadow-[0_0_0_2px_var(--navy)]" />
          </span>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-red" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fur-dark">{chosenLabel}</p>
          <p className="truncate text-lg font-semibold leading-tight">{value.name}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChoose(null);
            setTimeout(() => input.current?.focus(), 0);
          }}
          className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-navy hover:bg-concrete"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {searchLabel}
      </label>
      <input
        ref={input}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        enterKeyHint="go"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onFocus={() => {
          setRecent(readRecent(places));
          setFocused(true);
        }}
        // Delay so a tap on a suggestion lands before the list closes.
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={onKeyDown}
        className="w-full rounded-2xl border-2 border-transparent bg-white px-4 py-3 text-lg font-medium placeholder:font-normal placeholder:text-fur focus:border-navy focus-visible:outline-none"
      />

      {open && (
        <ul id={`${listId}-list`} role="listbox" className="mt-2 flex flex-col overflow-hidden rounded-2xl bg-white">
          {options.map((opt, i) => (
            <li
              key={opt.place.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(opt.place)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-4 py-3 ${i === active ? "bg-concrete" : ""}`}
            >
              <p className="font-medium">{opt.place.name}</p>
              <p className="text-sm text-fur-dark">
                {opt.note ? `${opt.note}, ` : ""}
                {opt.place.category}
              </p>
            </li>
          ))}
          {query.trim() && options.length === 0 && (
            <li className="px-4 py-3 text-sm text-fur-dark">
              {places.length === 0
                ? "Campus places haven't been loaded. Run npm run build:places, then restart the app."
                : `No campus place matches "${query.trim()}". Try a building name or nickname, like Javits or SAC.`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
