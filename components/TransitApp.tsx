"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import BottomSheet, { type Snap } from "./BottomSheet";
import NavMode from "./NavMode";
import ResultsPanel from "./ResultsPanel";
import SearchPanel from "./SearchPanel";
import SettingsPanel from "./SettingsPanel";
import StopPanel from "./StopPanel";
import TrainsPanel from "./TrainsPanel";
import type { TripOverlay } from "./MapView";
import { lngLat, PLACES, type Place } from "@/lib/places";
import type { RouteOption } from "@/lib/router";
import { DEFAULT_SETTINGS, NO_SAVED, useStored, type SavedPlace, type Settings } from "@/lib/storage";
import { useTrip, type Endpoint, type TripRequest } from "@/lib/trip";
import type { BusStop, LngLat } from "@/lib/types";
import { useBuses, useNetwork } from "@/lib/useLiveData";
import { useLeaveAlert } from "@/lib/useLeaveAlert";
import { useLocation } from "@/lib/useLocation";
import { useNow } from "@/lib/useNow";
import { unlockAudio } from "@/lib/voice";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type View = "home" | "search-to" | "search-from" | "results" | "nav" | "stop" | "settings";
type Origin = { kind: "me" } | { kind: "place"; place: Place };

function ago(ts: number | null, now: number) {
  if (!ts) return "connecting…";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 5 ? "just now" : `${s}s ago`;
}

function overlayFor(option: RouteOption | undefined, from: LngLat | null, to: Endpoint | null): TripOverlay | null {
  if (!option) return null;
  return {
    walk: option.legs.flatMap(l => (l.type === "walk" ? [l.coords] : [])),
    bus: option.legs.flatMap(l => (l.type === "bus" ? [{ coords: l.coords, color: l.color }] : [])),
    from: from ?? undefined,
    to: to ? [to.lng, to.lat] : undefined,
  };
}

export default function TransitApp() {
  const { routes, stops, error: networkError } = useNetwork();
  const { buses, source, updatedAt, error: busError } = useBuses();
  const [settings, setSettings] = useStored<Settings>("settings", DEFAULT_SETTINGS);
  const [saved, setSaved] = useStored<SavedPlace[]>("saved", NO_SAVED);
  const location = useLocation();
  const now = useNow();

  const [view, setView] = useState<View>("home");
  const [snap, setSnap] = useState<Snap>("half");
  const [sheetPx, setSheetPx] = useState(0);
  const [stop, setStop] = useState<BusStop | null>(null);
  const [origin, setOrigin] = useState<Origin>({ kind: "me" });
  const [request, setRequest] = useState<TripRequest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [homeTab, setHomeTab] = useState<"go" | "trains">("go");
  const [navOption, setNavOption] = useState<RouteOption | null>(null);
  const onHeight = useCallback((px: number) => setSheetPx(px), []);

  const fromCoords: LngLat | null = request?.from ? lngLat(request.from)
    : origin.kind === "place" ? lngLat(origin.place) : location.coords;
  const originName = request?.from ? request.from.name
    : origin.kind === "place" ? origin.place.name
    : location.status === "locating" ? "Finding you…"
    : location.status === "denied" ? "Location blocked: tap to choose"
    : "My location";
  const trip = useTrip(fromCoords, view === "results" ? request : null, settings.accessible);
  const options = trip.data?.options ?? [];
  const selected = options.find(o => o.id === selectedId) ?? options[0];
  const overlay = useMemo(
    () => (view === "results" ? overlayFor(selected, fromCoords, request?.to ?? null)
      : view === "nav" && navOption ? overlayFor(navOption, fromCoords, request?.to ?? null) : null),
    [view, selected, navOption, fromCoords, request],
  );

  const goTo = useCallback((req: TripRequest) => {
    setRequest(req);
    setSelectedId(null);
    setView("results");
    setSnap("half");
    if (!req.from && origin.kind === "me") location.start();
  }, [origin.kind, location]);

  useLeaveAlert(view === "results" ? selected : view === "nav" ? navOption ?? undefined : undefined, request, now, settings.voice, settings.language);

  const pickDestination = (p: Place) => goTo({ to: { name: p.name, lng: p.lng, lat: p.lat, placeId: p.id } });

  const onStopClick = useCallback((s: BusStop) => {
    setStop(s);
    setView("stop");
    setSnap("half");
  }, []);

  const savedHere = !!request?.to.placeId && saved.some(s => s.placeId === request.to.placeId);

  const header = (
    <header className="flex items-center gap-3 px-4 pb-3 pt-1 md:pt-4">
      <Image src="/icon-192.png" alt="" width={40} height={40} className="rounded-full ring-2 ring-brass" priority />
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-xl font-bold leading-none tracking-wide">Lupus</h1>
        <p className="truncate text-xs text-muted">Steel &amp; Steam campus transit</p>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${busError ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"}`}
        aria-live="polite"
      >
        {busError ? "Bus feed down" : `${source === "replay" ? "Replay" : "Live"} · ${ago(updatedAt, now)}`}
      </span>
      <button onClick={() => setView("settings")} aria-label="Settings" className="grid h-11 w-11 place-items-center rounded-full text-xl">
        ⚙︎
      </button>
    </header>
  );

  let body: React.ReactNode;
  if (view === "settings") {
    body = <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setView(navOption ? "nav" : request ? "results" : "home")} />;
  } else if (view === "stop" && stop) {
    body = <StopPanel key={stop.id} stop={stop} routes={routes} onClose={() => setView("home")} />;
  } else if (view === "search-to") {
    body = (
      <SearchPanel title="Where to?" saved={saved}
        onPick={p => { setSnap("half"); pickDestination(p); }}
        onCancel={() => setView(request ? "results" : "home")} />
    );
  } else if (view === "search-from") {
    body = (
      <SearchPanel title="Starting from…" saved={saved} allowMyLocation
        onMyLocation={() => { setOrigin({ kind: "me" }); location.start(); setView(request ? "results" : "home"); }}
        onPick={p => { setOrigin({ kind: "place", place: p }); setView(request ? "results" : "home"); }}
        onCancel={() => setView(request ? "results" : "home")} />
    );
  } else if (view === "nav" && navOption && request) {
    body = (
      <NavMode option={navOption} destination={request.to.name} lang={settings.language} voice={settings.voice}
        now={now} location={location.coords} onExit={() => { setNavOption(null); setView("results"); }} />
    );
  } else if (view === "results" && request) {
    body = (
      <ResultsPanel
        originName={originName}
        request={request}
        result={trip.data}
        error={trip.error ?? (origin.kind === "me" && location.status === "denied"
          ? { message: "Location is blocked. Choose where you're starting from.", offMap: false } : null)}
        loading={trip.loading || (origin.kind === "me" && location.status === "locating")}
        now={now}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onChangeOrigin={() => { setRequest(r => (r ? { ...r, from: undefined, departAt: undefined } : r)); setView("search-from"); setSnap("full"); }}
        onChangeDestination={() => { setView("search-to"); setSnap("full"); }}
        onClose={() => { setRequest(null); setView("home"); }}
        isSaved={savedHere}
        onSave={label => request.to.placeId && setSaved(s => [...s.filter(x => x.placeId !== request.to.placeId), { placeId: request.to.placeId!, label }])}
        onUnsave={() => setSaved(s => s.filter(x => x.placeId !== request.to.placeId))}
        onStart={option => {
          unlockAudio(); // must run inside the tap for iOS
          if (!request.from && origin.kind === "me") location.start();
          setNavOption(option);
          setView("nav");
          setSnap("half");
        }}
      />
    );
  } else if (homeTab === "trains") {
    body = <TrainsPanel now={now} bufferMin={settings.trainBufferMin} saved={saved} onPlan={goTo} />;
  } else {
    body = (
      <>
        <button
          onClick={() => { setView("search-to"); setSnap("full"); }}
          className="mb-3 flex h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left text-base text-muted"
        >
          <span aria-hidden>🔎</span> Where to?
        </button>
        {saved.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Saved places">
            {saved.map(s => {
              const p = PLACES.find(x => x.id === s.placeId);
              return p && (
                <button key={s.placeId} onClick={() => pickDestination(p)}
                  className="min-h-11 rounded-full border border-brass/50 bg-brass/10 px-3 text-sm font-medium">
                  ★ {s.label}
                </button>
              );
            })}
          </div>
        )}
        {networkError && (
          <p role="alert" className="mb-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">
            Couldn&apos;t load bus routes ({networkError}). Walking directions still work.
          </p>
        )}
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
          <p className="mt-3 text-sm text-muted">No buses in service right now. Tap a stop to see the next scheduled arrivals.</p>
        )}
      </>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapView routes={routes} stops={stops} buses={buses} overlay={overlay}
        userLocation={origin.kind === "me" ? location.coords : null}
        onStopClick={onStopClick} bottomPadding={sheetPx} />
      <BottomSheet snap={snap} onSnapChange={setSnap} onHeightChange={onHeight} header={header}>
        {view === "home" && (
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Sections">
            {(["go", "trains"] as const).map(t => (
              <button key={t} role="tab" aria-selected={homeTab === t} onClick={() => setHomeTab(t)}
                className={`min-h-11 rounded-lg text-sm font-semibold ${homeTab === t ? "plate" : "text-muted"}`}>
                {t === "go" ? "🧭 Go" : "🚂 Trains"}
              </button>
            ))}
          </div>
        )}
        {body}
      </BottomSheet>
    </main>
  );
}
