"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useBusFeed } from "@/hooks/useBusFeed";
import type { Place } from "@/lib/places";
import BusRow from "./BusRow";
import LiveMap from "./LiveMap";
import PlaceSearch from "./PlaceSearch";
import StatusPill from "./StatusPill";

export default function TransitApp() {
  const { feed, receivedAt, error } = useBusFeed();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const buses = feed?.buses ?? [];

  const toggleSelect = (id: string) => setSelectedId((cur) => (cur === id ? null : id));
  const onSearchOpen = useCallback((open: boolean) => {
    setSearching(open);
    if (open) setCollapsed(false);
  }, []);

  let heading = "Finding buses";
  if (feed) heading = buses.length === 1 ? "1 bus running" : `${buses.length} buses running`;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <LiveMap buses={buses} selectedId={selectedId} onSelect={toggleSelect} destination={destination} />

      {/* Top bar floats over the map */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] md:left-[25rem] md:right-14">
        <div className="pointer-events-auto rounded-full bg-white/95 px-4 py-2 shadow-[0_1px_4px_rgb(38_40_64/0.2)] md:hidden">
          <Image src="/logo.png" alt="Lupus" width={76} height={30} priority />
        </div>
        <div className="pointer-events-auto ml-auto mr-12 md:mr-0">
          <StatusPill feed={feed} receivedAt={receivedAt} error={error} />
        </div>
      </header>

      {/* Search and bus list: bottom sheet on phones, left panel on wider screens */}
      <section
        aria-label="Trip planner"
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl bg-concrete shadow-[0_-4px_16px_rgb(38_40_64/0.18)] transition-[max-height] duration-300 md:inset-y-4 md:left-4 md:right-auto md:max-h-none md:w-[23rem] md:rounded-3xl ${
          // While searching, the sheet fills most of the screen so the phone keyboard can't cover suggestions.
          collapsed ? "max-h-[9.5rem]" : searching ? "max-md:h-[88dvh] max-md:max-h-[88dvh]" : "max-h-[55dvh]"
        }`}
      >
        <div className="px-4 pt-3 md:pt-5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="bus-list"
            aria-label={collapsed ? "Show bus list" : "Hide bus list"}
            className="mx-auto mb-3 block h-5 w-16 md:hidden"
          >
            <span className="mx-auto block h-1.5 w-10 rounded-full bg-fur/50" />
          </button>
          <div className="mb-3 hidden px-1 md:block">
            <Image src="/logo.png" alt="Lupus" width={96} height={38} priority />
          </div>
          <PlaceSearch destination={destination} onChoose={setDestination} onOpenChange={onSearchOpen} />
        </div>

        {!searching && (
          <>
            <h2 className="px-5 pb-2 pt-4 text-xl font-semibold">{heading}</h2>
            {feed?.notice && (
              <p className="mx-4 mb-2 rounded-xl bg-white px-3 py-2 text-sm text-fur-dark">{feed.notice}</p>
            )}
            {error && <p className="mx-4 mb-2 rounded-xl bg-white px-3 py-2 text-sm text-red-deep">{error}</p>}

            <ul
              id="bus-list"
              className="flex flex-col gap-2 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {buses.map((bus) => (
                <BusRow key={bus.id} bus={bus} selected={bus.id === selectedId} onSelect={toggleSelect} />
              ))}
              {feed && buses.length === 0 && (
                <li className="rounded-2xl bg-white px-4 py-5 text-sm text-fur-dark">
                  No buses are in service right now. Lupus checks again every 10 seconds.
                </li>
              )}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
