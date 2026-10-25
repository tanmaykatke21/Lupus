"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import AskLupus from "./AskLupus";
import BottomSheet, { type Snap } from "./BottomSheet";
import ClassesPanel from "./ClassesPanel";
import CompassHome from "./CompassHome";
import LocationHelp from "./LocationHelp";
import NavMode from "./NavMode";
import ResultsPanel from "./ResultsPanel";
import SearchPanel from "./SearchPanel";
import SettingsPanel from "./SettingsPanel";
import StopPanel from "./StopPanel";
import TrainsPanel from "./TrainsPanel";
import type { TripOverlay } from "@/lib/mapShared";
import { lngLat, placeById, PLACES, type Place } from "@/lib/places";
import type { AnswerCard } from "@/lib/agent/run";
import { classStartsAt, NO_CLASSES, nextClass, type ClassEntry } from "@/lib/classes";
import type { RouteOption } from "@/lib/router";
import { campusClock, formatClock } from "@/lib/time";
import { DEFAULT_SETTINGS, NO_SAVED, useStored, type SavedPlace, type Settings } from "@/lib/storage";
import { useTrip, type Endpoint, type TripRequest } from "@/lib/trip";
import type { BusStop, LngLat } from "@/lib/types";
import { useHeading } from "@/lib/useHeading";
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

function classRequest(cls: ClassEntry, startsAt: number): TripRequest | null {
  const p = cls.placeId ? PLACES.find(x => x.id === cls.placeId) : undefined;
  if (!p) return null;
  const label = `${cls.course} at ${formatClock(startsAt)}`;
  return {
    to: { name: p.name, lng: p.lng, lat: p.lat, placeId: p.id },
    arriveBy: startsAt - 2 * 60_000, // a couple of minutes to find a seat
    context: label,
    purpose: `to make ${label}`,
  };
}

const pathsOf = (o: RouteOption) => ({
  walk: o.legs.flatMap(l => (l.type === "walk" ? [l.coords] : [])),
  bus: o.legs.flatMap(l => (l.type === "bus" ? [{ coords: l.coords, color: l.color }] : [])),
});

function overlayFor(option: RouteOption | undefined, from: LngLat | null, to: Endpoint | null, others: RouteOption[] = []): TripOverlay | null {
  if (!option) return null;
  return {
    ...pathsOf(option),
    from: from ?? undefined,
    to: to ? [to.lng, to.lat] : undefined,
    alternatives: others.filter(o => o.id !== option.id && !o.slowerThanWalk).map(pathsOf),
  };
}

export default function TransitApp() {
  const { routes, stops, error: networkError } = useNetwork();
  const [settings, setSettings] = useStored<Settings>("settings", DEFAULT_SETTINGS);
  const [replay, setReplay] = useStored<boolean>("replay", false);
  const [demoFull, setDemoFull] = useStored<boolean>("demoFull", false);
  const { buses, source, updatedAt, error: busError } = useBuses(replay);
  const [saved, setSaved] = useStored<SavedPlace[]>("saved", NO_SAVED);
  const [classes, setClasses] = useStored<ClassEntry[]>("classes", NO_CLASSES);
  const location = useLocation();
  const heading = useHeading();
  const now = useNow();
  // Compass (schedule-first) is home; the map is secondary.
  const [mode, setMode] = useStored<"compass" | "map">("mode", "compass");
  const [guiding, setGuiding] = useState(false);

  const [view, setView] = useState<View>("home");
  const [snap, setSnap] = useState<Snap>("half");
  const [sheetPx, setSheetPx] = useState(0);
  const [stop, setStop] = useState<BusStop | null>(null);
  const [origin, setOrigin] = useState<Origin>({ kind: "me" });
  const [request, setRequest] = useState<TripRequest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [homeTab, setHomeTab] = useState<"go" | "trains" | "classes">("go");
  const [navOption, setNavOption] = useState<RouteOption | null>(null);
  // Map follow mode (heading-up navigation view); paused when the user drags the map.
  const [following, setFollowing] = useState(false);
  const onHeight = useCallback((px: number) => setSheetPx(px), []);

  const fromCoords: LngLat | null = request?.from ? lngLat(request.from)
    : origin.kind === "place" ? lngLat(origin.place) : location.coords;
  const originName = request?.from ? request.from.name
    : origin.kind === "place" ? origin.place.name
    : location.status === "locating" ? "Finding you…"
    : location.status === "denied" ? "Location blocked: tap to choose"
    : "My location";
  // In compass mode with no explicit trip, the next class on the schedule is the trip.
  const upcoming = now ? nextClass(classes, new Date(now), campusClock) : null;
  const upcomingCls = upcoming?.cls ?? null;
  const upcomingStart = upcoming ? classStartsAt(now, upcoming.inMinutes) : 0;
  const scheduleRequest = useMemo(
    () => (upcomingCls ? classRequest(upcomingCls, upcomingStart) : null),
    [upcomingCls, upcomingStart],
  );
  const compassRequest = request ?? scheduleRequest;
  const activeRequest = mode === "compass" ? compassRequest : view === "results" ? request : null;
  const trip = useTrip(fromCoords, activeRequest, settings.accessible, replay, demoFull);

  // Plan from the device location without a tap when permission was already granted.
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName })
      .then(s => { if (s.state === "granted") location.start(); })
      .catch(() => {});
  }, [location]);

  // ?replay=1 / ?replay=0 in the URL switches replay mode (handy on the judging laptop).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("replay");
    if (p === "1" || p === "0") setReplay(p === "1");
  }, [setReplay]);
  const options = useMemo(() => trip.data?.options ?? [], [trip.data]);
  const selected = options.find(o => o.id === selectedId) ?? options[0];
  const overlay = useMemo(
    () => (view === "results" ? overlayFor(selected, fromCoords, request?.to ?? null, options)
      : view === "nav" && navOption ? overlayFor(navOption, fromCoords, request?.to ?? null) : null),
    [view, selected, navOption, fromCoords, request, options],
  );

  const goTo = useCallback((req: TripRequest) => {
    setRequest(req);
    setSelectedId(null);
    setView("results");
    setSnap("half");
    if (!req.from && origin.kind === "me") location.start();
  }, [origin.kind, location]);

  useLeaveAlert(
    mode === "compass" ? (guiding ? undefined : selected) : view === "results" ? selected : view === "nav" ? navOption ?? undefined : undefined,
    mode === "compass" ? compassRequest : request, now, settings.voice, settings.language);

  const pickDestination = (p: Place) => goTo({ to: { name: p.name, lng: p.lng, lat: p.lat, placeId: p.id } });

  const goToClass = (cls: ClassEntry, startsAt: number) => {
    const req = classRequest(cls, startsAt);
    if (req) goTo(req);
  };

  // Ask Lupus answers become ordinary trips, for the compass or the map.
  const requestFromCard = (card: AnswerCard): TripRequest | null => {
    const to = placeById(card.toPlaceId);
    if (!to) return null;
    const from = card.from.placeId ? placeById(card.from.placeId) : undefined;
    return {
      to: { name: to.name, lng: to.lng, lat: to.lat, placeId: to.id },
      from: from ? { name: from.name, lng: from.lng, lat: from.lat, placeId: from.id } : undefined,
      arriveBy: card.deadlineMs ?? undefined,
      context: card.context ?? undefined,
      purpose: card.context ? `to catch ${card.context}` : undefined,
    };
  };
  const agentCurrent = location.coords ? { lng: location.coords[0], lat: location.coords[1], label: "Your location" }
    : origin.kind === "place" ? { lng: origin.place.lng, lat: origin.place.lat, label: origin.place.name } : null;
  const askLupus = (
    <AskLupus current={agentCurrent} accessible={settings.accessible} voice={settings.voice} lang={settings.language}
      onGuide={card => {
        const req = requestFromCard(card);
        if (!req) return;
        unlockAudio(); // inside the tap, for iOS
        heading.start();
        if (!req.from) location.start();
        setRequest(req);
        setMode("compass");
        setGuiding(true);
      }}
      onShowMap={card => {
        const req = requestFromCard(card);
        if (!req) return;
        setMode("map");
        goTo(req);
      }} />
  );

  const onStopClick = useCallback((s: BusStop) => {
    setStop(s);
    setView("stop");
    setSnap("half");
  }, []);

  const etaOption = view === "nav" ? navOption ?? undefined : view === "results" ? selected : undefined;
  const savedHere = !!request?.to.placeId && saved.some(s => s.placeId === request.to.placeId);

  const header = (
    <header className="flex items-center gap-3 px-4 pb-3 pt-1 md:pt-4">
      <Image src="/icon-192.png" alt="" width={40} height={40} className="rounded-full ring-2 ring-brass" priority />
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-xl font-bold leading-none tracking-wide">Lupus</h1>
        {etaOption ? (
          <p className="truncate text-xs font-semibold text-ink" aria-live="polite">ETA {formatClock(etaOption.arriveAt)} · {request?.to.name}</p>
        ) : (
          <p className="truncate text-xs text-muted">Steel &amp; Steam campus transit</p>
        )}
      </div>
      <button onClick={() => setMode("compass")} aria-label="Compass" className="grid h-11 w-11 place-items-center rounded-full border border-line text-lg">🧭</button>
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
    body = (
      <SettingsPanel settings={settings} onChange={setSettings} replay={replay} onReplay={setReplay}
        demoFull={demoFull} onDemoFull={setDemoFull}
        onClose={() => setView(navOption ? "nav" : request ? "results" : "home")} />
    );
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
        now={now} location={location.coords} onExit={() => { setNavOption(null); setFollowing(false); setView("results"); }} />
    );
  } else if (view === "results" && request) {
    body = (
      <>
      {origin.kind === "me" && !request.from && (
        <div className="mb-3">
          <LocationHelp status={location.status} onRetry={() => location.start()}
            onPickStart={() => { setView("search-from"); setSnap("full"); }} />
        </div>
      )}
      <ResultsPanel
        originName={originName}
        request={request}
        result={trip.data}
        error={trip.error}
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
          heading.start(); // iOS asks for motion access here, for the heading-up map
          if (!request.from && origin.kind === "me") location.start();
          setFollowing(true);
          setNavOption(option);
          setView("nav");
          setSnap("half");
        }}
      />
      </>
    );
  } else if (homeTab === "classes") {
    body = <ClassesPanel classes={classes} now={now} onChange={setClasses} onGo={goToClass} />;
  } else if (homeTab === "trains") {
    body = <TrainsPanel now={now} bufferMin={settings.trainBufferMin} saved={saved} onPlan={goTo} />;
  } else {
    body = (
      <>
        <div className="mb-3">{askLupus}</div>
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

  if (mode === "compass") {
    const toMap = () => {
      setGuiding(false);
      if (compassRequest) { setRequest(compassRequest); setView("results"); setSnap("half"); }
      setMode("map");
    };
    return (
      <main className="h-dvh w-full overflow-hidden">
        <CompassHome
          now={now}
          request={compassRequest}
          fromSchedule={!request && !!scheduleRequest}
          option={selected}
          loading={trip.loading}
          error={trip.error?.message ?? null}
          location={location.coords}
          locationStatus={location.status}
          heading={heading.heading}
          headingStatus={heading.status}
          guiding={guiding}
          voice={settings.voice}
          lang={settings.language}
          onGuide={() => {
            unlockAudio(); // inside the tap, for iOS audio
            heading.start(); // iOS asks for motion access here
            location.start();
            setGuiding(true);
          }}
          onEnd={() => setGuiding(false)}
          onOpenMap={toMap}
          onAddSchedule={() => { setMode("map"); setView("home"); setHomeTab("classes"); setSnap("full"); }}
          onPickDestination={() => { setGuiding(false); setMode("map"); setView("search-to"); setSnap("full"); }}
          onSettings={() => { setMode("map"); setView("settings"); setSnap("full"); }}
          onRetryLocation={() => location.start()}
          onPickStart={() => {
            setGuiding(false);
            if (compassRequest) setRequest(compassRequest);
            setMode("map"); setView("search-from"); setSnap("full");
          }}
          ask={askLupus}
        />
      </main>
    );
  }

  // Frame the map only when the trip or the chosen option changes, not on every refresh or GPS fix.
  const shownOption = view === "nav" ? navOption : view === "results" ? selected : null;
  const fitKey = overlay && request && shownOption ? `${request.to.lng},${request.to.lat}|${shownOption.id}|${view}` : null;
  const canFollow = !!overlay && origin.kind === "me" && !!location.coords && (view === "results" || view === "nav");
  const followOn = following && canFollow;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapView routes={routes} stops={stops} buses={buses} overlay={overlay}
        userLocation={origin.kind === "me" ? location.coords : null}
        onStopClick={onStopClick} bottomPadding={sheetPx}
        fitKey={fitKey}
        follow={{ on: followOn, heading: heading.heading ?? location.course }}
        onUserPan={() => setFollowing(false)} />
      {canFollow && (
        <button
          onClick={() => { if (!followOn) heading.start(); setFollowing(f => !f); }}
          aria-pressed={followOn}
          className={`absolute right-3 z-10 flex h-12 items-center gap-2 rounded-full px-4 text-sm font-bold shadow-lg ${followOn ? "btn-brass" : "plate"}`}
          style={{ bottom: sheetPx + 12 }}
        >
          {followOn ? "🧭 Following" : "📍 Follow me"}
        </button>
      )}
      <BottomSheet snap={snap} onSnapChange={setSnap} onHeightChange={onHeight} header={header}>
        {view === "home" && (
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Sections">
            {(["go", "trains", "classes"] as const).map(t => (
              <button key={t} role="tab" aria-selected={homeTab === t} onClick={() => setHomeTab(t)}
                className={`min-h-11 rounded-lg text-sm font-semibold ${homeTab === t ? "plate" : "text-muted"}`}>
                {t === "go" ? "🧭 Go" : t === "trains" ? "🚂 Trains" : "🎓 Classes"}
              </button>
            ))}
          </div>
        )}
        {body}
      </BottomSheet>
    </main>
  );
}
