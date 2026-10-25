"use client";

import Image from "next/image";
import CompassView from "./CompassView";
import Gauge from "./Gauge";
import type { RouteOption } from "@/lib/router";
import { formatClock } from "@/lib/time";
import type { TripRequest } from "@/lib/trip";
import type { HeadingStatus } from "@/lib/useHeading";
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
  locationStatus: string;
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
}

function legSummary(o: RouteOption) {
  return o.legs
    .filter(l => l.type === "bus" || (l.type === "walk" && l.seconds >= 30))
    .map(l => (l.type === "walk" ? `🚶 ${Math.max(1, Math.round(l.seconds / 60))}` : l.type === "bus" ? `🚌 ${l.routeName}` : ""))
    .join("  ›  ");
}

export default function CompassHome(p: Props) {
  const o = p.option;
  const late = o && p.request?.arriveBy ? Math.round((o.arriveAt - p.request.arriveBy) / 60_000) : null;

  // The ETA lives in the header on every screen of the trip.
  const header = (
    <header className="plate flex items-center gap-3 rounded-b-3xl px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)]">
      <Image src="/icon-192.png" alt="" width={36} height={36} className="rounded-full ring-2 ring-brass" priority />
      <div className="min-w-0 flex-1">
        {p.request ? (
          <>
            <p className="truncate text-xs font-semibold uppercase tracking-widest text-muted">
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
          <h1 className="font-display text-xl font-bold">Lupus</h1>
        )}
      </div>
      <button onClick={p.onOpenMap} className="h-11 rounded-full border border-line px-3 text-sm font-semibold" aria-label="Open map">🗺 Map</button>
      <button onClick={p.onSettings} aria-label="Settings" className="grid h-11 w-11 place-items-center rounded-full text-xl">⚙︎</button>
    </header>
  );

  if (p.guiding && o && p.request) {
    return (
      <div className="flex h-dvh flex-col bg-bg">
        {header}
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
          <section className="plate rivets rounded-3xl p-5 text-center">
            <p className="text-5xl" aria-hidden>🧭</p>
            <h2 className="mt-2 font-display text-2xl font-bold">Your schedule drives Lupus</h2>
            <p className="mt-1 text-muted">Add your classes once. Lupus picks the next one, finds the fastest way there, and points the way.</p>
            <button onClick={p.onAddSchedule} className="btn-brass mt-4 h-12 w-full rounded-xl font-bold">📸 Add my schedule</button>
            <button onClick={p.onPickDestination} className="mt-2 h-12 w-full rounded-xl border border-line font-semibold">Go somewhere else</button>
          </section>
        ) : (
          <section className="plate rivets rounded-3xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">{p.fromSchedule ? "Next up" : "Heading to"}</p>
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
                </div>
                <Gauge slack={o.slackMinutes === null ? null : (o.leaveBy - p.now) / 60_000} size={72} />
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted" role="status">
                {p.error ?? (p.locationStatus === "denied" ? "Location is blocked, so Lupus can't plan from where you are." : p.loading || p.locationStatus === "locating" ? "Finding the fastest way…" : "Tap below to find your way.")}
              </p>
            )}

            <button onClick={p.onGuide} className="btn-brass mt-5 h-14 w-full rounded-2xl text-lg font-bold">🧭 Guide me</button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={p.onOpenMap} className="h-11 rounded-xl border border-line text-sm font-semibold">See on map</button>
              <button onClick={p.onPickDestination} className="h-11 rounded-xl border border-line text-sm font-semibold">Somewhere else</button>
            </div>
          </section>
        )}
        <p className="text-center text-xs text-muted">The compass points along your route, bus included. The map is one tap away.</p>
      </div>
    </div>
  );
}
