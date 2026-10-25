"use client";

import Image from "next/image";
import lupusIcon from "@/assets/icon.png";
import lupusLogo from "@/assets/logo.png";
import { useEffect, useState } from "react";
import { skippedNote } from "@/lib/crowding";
import { announce } from "@/lib/voice";
import CompassView from "./CompassView";
import Gauge from "./Gauge";
import Icon from "./Icon";
import LocationHelp from "./LocationHelp";
import { SavedChips } from "./PlaceResults";
import type { Place } from "@/lib/places";
import type { SavedPlace } from "@/lib/storage";
import type { RouteOption } from "@/lib/router";
import { formatClock } from "@/lib/time";
import type { TripRequest } from "@/lib/trip";
import type { HeadingStatus } from "@/lib/useHeading";
import type { LocationStatus } from "@/lib/useLocation";
import type { LngLat } from "@/lib/types";
import { countdown } from "@/lib/useNow";

interface Props {
  now: number;
  request: TripRequest | null; // explicit trip, or the next class
  fromSchedule: boolean;
  option: RouteOption | undefined;
  loading: boolean;
  error: string | null;
  location: LngLat | null;
  locationStatus: LocationStatus;
  onRetryLocation: () => void;
  onPickStart: () => void;
  heading: number | null;
  headingStatus: HeadingStatus;
  guiding: boolean;
  voice: boolean;
  lang: string;
  onGuide: () => void;
  onEnd: () => void;
  onOpenMap: () => void;
  onAddSchedule: () => void;
  onPickDestination: () => void;
  onSettings: () => void;
  saved: SavedPlace[];
  onGoSaved: (place: Place) => void;
  ask?: React.ReactNode;
}

/** What changed, in words, when the plan switches mid-trip. */
function rerouteText(o: RouteOption) {
  const bus = o.legs.find(l => l.type === "bus");
  const plan = bus?.type === "bus"
    ? `take the ${bus.routeName} from ${bus.boardStopName} at ${formatClock(bus.departAt)}`
    : "walk the rest of the way";
  return o.skippedFull ? `${skippedNote(o.skippedFull)} New plan: ${plan}.` : `Faster way found: ${plan}.`;
}

function legSummary(o: RouteOption) {
  return o.legs
    .filter(l => l.type === "bus" || (l.type === "walk" && l.seconds >= 30))
    .map(l => (l.type === "walk" ? `Walk ${Math.max(1, Math.round(l.seconds / 60))} min` : l.type === "bus" ? l.routeName : ""))
    .join("  ›  ");
}

export default function CompassHome(p: Props) {
  const o = p.option;

  // Reroute: while guiding, a new best option (e.g. our bus filled up) replaces the plan; say so.
  const [seenId, setSeenId] = useState<string | null>(o?.id ?? null);
  const [reroute, setReroute] = useState<string | null>(null);
  if (o && o.id !== seenId) {
    if (p.guiding && seenId !== null) setReroute(rerouteText(o));
    setSeenId(o.id);
  }
  useEffect(() => {
    if (reroute && p.voice) announce(reroute, { lang: p.lang });
    // Speak once per new reroute message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reroute]);
  const late = o && p.request?.arriveBy ? Math.round((o.arriveAt - p.request.arriveBy) / 60_000) : null;

  // The ETA lives in the header on every screen of the trip.
  const header = (
    <header className="plate mx-3 mt-[max(env(safe-area-inset-top),12px)] flex items-center gap-3 rounded-[24px] px-3 py-2.5">
      <Image src={lupusIcon} alt="" width={36} height={36} className="h-9 w-9" priority />
      <div className="min-w-0 flex-1">
        {p.request ? (
          <>
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
              {p.request.context ?? p.request.to.name}
              {late !== null && (
                <span className={`ml-1.5 normal-case tracking-normal ${late > 0 ? "text-danger" : "text-ok"}`}>
                  · {late > 0 ? `${late} min late` : late === 0 ? "on time" : `${-late} min early`}
                </span>
              )}
            </p>
            <p className="truncate font-display text-xl font-bold leading-tight tabular-nums" aria-live="polite">
              {o ? <>ETA {formatClock(o.arriveAt)}</> : p.loading ? "Finding route…" : "No route yet"}
            </p>
          </>
        ) : (
          <h1 className="leading-none"><Image src={lupusLogo} alt="Lupus" className="h-[22px] w-auto dark:invert" priority /></h1>
        )}
      </div>
      <button onClick={p.onOpenMap} className="h-11 rounded-full btn-glass px-3 text-sm font-semibold" aria-label="Open map">Map</button>
      <button onClick={p.onSettings} aria-label="Settings" className="glass-icon h-10 w-10"><Icon name="gear" /></button>
    </header>
  );

  if (p.guiding && o && p.request) {
    return (
      <div className="flex h-dvh flex-col bg-bg">
        {header}
        <div className="mx-4 mt-3"><LocationHelp status={p.locationStatus} onRetry={p.onRetryLocation} onPickStart={p.onPickStart} /></div>
        {reroute && (
          <div role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-2xl border-2 border-copper bg-copper/15 p-3 text-sm font-semibold">
            <span className="flex-1">{reroute}</span>
            <button onClick={() => setReroute(null)} aria-label="Dismiss" className="-m-1 grid h-8 w-8 place-items-center rounded-full"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        )}
        <CompassView key={o.id} option={o} destination={p.request.to.name} location={p.location}
          heading={p.heading} headingStatus={p.headingStatus} now={p.now} voice={p.voice} lang={p.lang} onEnd={p.onEnd} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {header}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
        {!p.request ? (
          <section className="plate rounded-3xl p-5 text-center">
            <Icon name="compass" className="mx-auto h-14 w-14 text-brass" />
            <h2 className="mt-2 font-display text-2xl font-bold">Your schedule drives Lupus</h2>
            <p className="mt-1 text-muted">Add your classes once. Lupus picks the next one, finds the fastest way there, and points the way.</p>
            <button onClick={p.onAddSchedule} className="btn-brass mt-4 h-12 w-full rounded-full font-bold">Add my schedule</button>
            <button onClick={p.onPickDestination} className="mt-2 h-12 w-full rounded-full btn-glass font-semibold">Go somewhere else</button>
            <SavedChips saved={p.saved} onPick={p.onGoSaved} className="mt-3 justify-center" />
          </section>
        ) : (
          <section className="plate rounded-3xl p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{p.fromSchedule ? "Next up" : "Heading to"}</p>
            <h2 className="font-display text-3xl font-bold leading-tight">{p.request.context?.split(" at ")[0] ?? p.request.to.name}</h2>
            {p.request.context && (
              <p className="text-muted">
                {p.request.to.name}
                {p.fromSchedule && p.request.arriveBy && <> · starts {formatClock(p.request.arriveBy + 2 * 60_000)}</>}
              </p>
            )}

            {o ? (
              <div className="mt-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm text-muted">{o.slackMinutes === null ? "Leave now" : `Leave by ${formatClock(o.leaveBy)}`}</p>
                  <p className="font-display text-4xl font-bold tabular-nums">
                    {o.slackMinutes === null || o.leaveBy - p.now <= 0 ? "Go now" : countdown(o.leaveBy - p.now)}
                  </p>
                  <p className="mt-1 text-sm">{legSummary(o)}</p>
                  {o.skippedFull && <p className="mt-1 text-xs font-semibold text-copper">{skippedNote(o.skippedFull)}</p>}
                </div>
                <Gauge slack={o.slackMinutes === null ? null : (o.leaveBy - p.now) / 60_000} size={72} />
              </div>
            ) : p.locationStatus === "denied" || p.locationStatus === "unavailable" ? (
              <div className="mt-4"><LocationHelp status={p.locationStatus} onRetry={p.onRetryLocation} onPickStart={p.onPickStart} /></div>
            ) : (
              <p className="mt-4 text-sm text-muted" role="status">
                {p.error ?? (p.loading || p.locationStatus === "locating" ? "Finding the fastest way…" : "Tap below to find your way.")}
              </p>
            )}

            <button onClick={p.onGuide} className="btn-brass mt-5 h-14 w-full rounded-full text-lg font-bold">Guide me</button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={p.onOpenMap} className="h-11 rounded-full btn-glass text-sm font-semibold">See on map</button>
              <button onClick={p.onPickDestination} className="h-11 rounded-full btn-glass text-sm font-semibold">Somewhere else</button>
            </div>
            <SavedChips saved={p.saved} exclude={p.request.to.placeId} onPick={p.onGoSaved} className="mt-3" />
          </section>
        )}
        {p.ask}
        <p className="text-center text-xs text-muted">The compass points along your route, bus included. The map is one tap away.</p>
      </div>
    </div>
  );
}
