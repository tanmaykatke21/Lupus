"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useState } from "react";
import BottomSheet, { type Snap } from "./BottomSheet";
import StopPanel from "./StopPanel";
import { useBuses, useNetwork } from "@/lib/useLiveData";
import type { BusStop } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

function ago(ts: number | null) {
  if (!ts) return "connecting…";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 5 ? "just now" : `${s}s ago`;
}

export default function TransitApp() {
  const { routes, stops, error: networkError } = useNetwork();
  const { buses, source, updatedAt, error: busError } = useBuses();
  const [snap, setSnap] = useState<Snap>("half");
  const [sheetPx, setSheetPx] = useState(0);
  const [stop, setStop] = useState<BusStop | null>(null);
  const onHeight = useCallback((px: number) => setSheetPx(px), []);

  const onStopClick = useCallback((s: BusStop) => {
    setStop(s);
    setSnap("half");
  }, []);

  const header = (
    <header className="flex items-center gap-3 px-4 pb-3 pt-1 md:pt-4">
      <Image src="/icon-192.png" alt="" width={40} height={40} className="rounded-full ring-2 ring-brass" priority />
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-xl font-bold leading-none tracking-wide">Lupus</h1>
        <p className="text-xs text-muted">Steel &amp; Steam campus transit</p>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${busError ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"}`}
        aria-live="polite"
      >
        {busError ? "Bus feed down" : `${source === "replay" ? "Replay" : "Live"} · ${ago(updatedAt)}`}
      </span>
    </header>
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapView routes={routes} stops={stops} buses={buses} onStopClick={onStopClick} bottomPadding={sheetPx} />

      <BottomSheet snap={snap} onSnapChange={setSnap} onHeightChange={onHeight} header={header}>
        {networkError && (
          <p role="alert" className="mb-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">
            Couldn&apos;t load bus routes: {networkError}
          </p>
        )}

        {stop ? (
          <StopPanel key={stop.id} stop={stop} routes={routes} onClose={() => setStop(null)} />
        ) : (
          <>
            <label className="sr-only" htmlFor="search">Where to?</label>
            <input
              id="search"
              placeholder="Where to?"
              className="mb-4 h-12 w-full rounded-xl border border-line bg-surface px-4 text-base placeholder:text-muted"
              disabled
            />
            <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-muted">Lines</h2>
            <ul className="space-y-2">
              {routes.map(r => {
                const count = buses.filter(b => b.routeId === r.id).length;
                return (
                  <li key={r.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
                    <span className="h-3 w-8 rounded-full" style={{ background: r.color }} aria-hidden />
                    <span className="flex-1 font-medium">{r.name}</span>
                    <span className="text-sm text-muted">{count ? `${count} running` : "not running"}</span>
                  </li>
                );
              })}
            </ul>
            {routes.length > 0 && buses.length === 0 && !busError && (
              <p className="mt-3 text-sm text-muted">
                No buses in service right now. Tap a stop to see the next scheduled arrivals.
              </p>
            )}
          </>
        )}
      </BottomSheet>
    </main>
  );
}
