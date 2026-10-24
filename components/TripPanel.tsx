"use client";

import { useEffect, useMemo, useState } from "react";
import { clockAfter, minLabel } from "@/lib/campusClock";
import type { Bus } from "@/lib/etaspot";
import type { LatLng } from "@/lib/geo";
import type { Network } from "@/lib/network";
import { planTrip, type LeaveStatus, type TripOption, type TripPlan } from "@/lib/planner";
import { routeColor, routeLabel, routeName, textOn } from "@/lib/routes";

interface Props {
  origin: LatLng;
  destination: LatLng;
  network: Network;
  buses: Bus[];
  /** When the bus data was received, so countdowns keep running between updates. */
  receivedAt: number;
  /** Lets the map highlight the stops of the option being shown. */
  onShow: (option: TripOption | null) => void;
  /** A deadline the rider gave Ask Lupus ("lab at 3"), kept live as buses move. */
  deadline?: { label: string; atMs: number } | null;
  /**
   * Shift for the clock times shown. With saved sample data, times follow the sample's own clock
   * (as the bus list and Ask Lupus do) so a demo never mixes 2:30 PM data with the real time.
   */
  clockShiftMs?: number;
}

/** Age every bus's predictions by the time since the feed arrived, dropping stops it has already passed. */
function ageBuses(buses: Bus[], elapsedMin: number): Bus[] {
  if (elapsedMin <= 0) return buses;
  return buses.map((b) => ({
    ...b,
    upcoming: b.upcoming
      .map((u) => ({ ...u, minutes: u.minutes - elapsedMin }))
      .filter((u) => u.minutes > -0.5)
      .map((u) => ({ ...u, minutes: Math.max(0, u.minutes) })),
  }));
}

const STATUS_COPY: Record<LeaveStatus, { word: string; tone: string }> = {
  relax: { word: "Relax", tone: "text-navy" },
  walk: { word: "Walk", tone: "text-navy" },
  run: { word: "Run", tone: "text-red" },
};

function headline(o: TripOption): string {
  if (o.status === "relax") return `Leave in ${Math.round(o.leaveInMin)} min`;
  if (o.status === "walk") return "Leave now";
  return "Run for it";
}

function RouteChip({ routeId, network }: { routeId: number; network: Network }) {
  const color = routeColor(routeId, network);
  return (
    <span
      className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg px-1.5 text-xs font-semibold"
      style={{ background: color, color: textOn(color) }}
    >
      {routeLabel(routeId, network)}
    </span>
  );
}

/** Relax / Walk / Run, with the current one filled in. */
function StatusScale({ status }: { status: LeaveStatus }) {
  const order: LeaveStatus[] = ["relax", "walk", "run"];
  return (
    <div className="flex gap-1.5" role="img" aria-label={`Pace: ${STATUS_COPY[status].word}`}>
      {order.map((s) => (
        <span
          key={s}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            s === status ? (s === "run" ? "bg-red text-white" : "bg-navy text-white") : "bg-concrete text-fur-dark"
          }`}
        >
          {STATUS_COPY[s].word}
        </span>
      ))}
    </div>
  );
}

/** "12 min to spare before 3:00 PM" / "About 4 min late for 3:00 PM", from minutes left after arriving. */
function bufferText(spare: number, label: string): string {
  const m = Math.round(Math.abs(spare));
  if (spare >= 0.5) return `${m} min to spare before ${label}`;
  if (spare > -0.5) return `Right on time for ${label}`;
  return `About ${m} min late for ${label}`;
}

export default function TripPanel({ origin, destination, network, buses, receivedAt, onShow, deadline, clockShiftMs = 0 }: Props) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const base = now ?? receivedAt;
  const clock = base + clockShiftMs;
  // Recompute once per second from the latest bus data; the planner is cheap.
  const plan: TripPlan = useMemo(
    () => planTrip(origin, destination, network, ageBuses(buses, (base - receivedAt) / 60_000)),
    [origin, destination, network, buses, receivedAt, base],
  );

  const top = plan.best === "bus" ? plan.options[0] : null;
  useEffect(() => onShow(top ?? null), [top?.busId, top?.board.stop.id, top?.alight.stop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Walk 2 more min to X and save 7": compare the best option with the one from the closest stop.
  const closest = [...plan.options].sort((a, b) => a.board.walkMin - b.board.walkMin)[0];
  const tradeoff =
    top && closest && closest !== top && top.board.walkMin - closest.board.walkMin >= 0.5 &&
    closest.arriveInMin - top.arriveInMin >= 1
      ? `Walk ${minLabel(top.board.walkMin - closest.board.walkMin)} more to ${top.board.stop.name} and arrive ${minLabel(
          closest.arriveInMin - top.arriveInMin,
        )} sooner than from ${closest.board.stop.name}.`
      : null;

  const others = plan.options.filter((o) => o !== top).slice(0, 3);
  const spare = deadline ? (deadline.atMs - base) / 60_000 - (top ? top.arriveInMin : plan.walkMin) : null;
  const deadlineLine =
    deadline && spare !== null ? (
      <p className={`mt-2 text-sm font-semibold ${spare < 0 ? "text-red-deep" : ""}`}>{bufferText(spare, deadline.label)}</p>
    ) : null;
  const about = (o: TripOption) => (o.estimated ? "about " : "");

  return (
    <div className="flex flex-col gap-2">
      {top ? (
        <article className="rounded-2xl bg-white p-4" aria-live="polite">
          <h3 className={`tabular text-3xl font-semibold leading-tight ${STATUS_COPY[top.status].tone}`}>
            {headline(top)}
          </h3>
          <div className="mt-2">
            <StatusScale status={top.status} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <RouteChip routeId={top.routeId} network={network} />
            <p className="font-medium">
              {routeName(top.routeId, network)} from {top.board.stop.name}
            </p>
          </div>
          <p className="mt-1 text-sm text-fur-dark">
            Bus arrives {clockAfter(clock, top.boardInMin)}. Walk {minLabel(top.board.walkMin)} to the stop, ride{" "}
            {about(top)}
            {minLabel(top.rideMin)} to {top.alight.stop.name}, then walk {minLabel(top.alight.walkMin)}.
          </p>
          <div className="lane mt-3 h-2 rounded-full" aria-hidden="true" />
          <p className="mt-3 text-sm">
            Arrive {about(top)}
            <span className="font-semibold">{clockAfter(clock, top.arriveInMin)}</span>
            <span className="text-fur-dark">, {minLabel(plan.walkMin - top.arriveInMin)} faster than walking</span>
          </p>
          {deadlineLine}
          {top.estimated && (
            <p className="mt-1 text-xs text-fur-dark">
              Part of this ride is estimated: ETA Spot only predicts each bus&apos;s next few stops.
            </p>
          )}
          {tradeoff && <p className="mt-3 rounded-xl bg-concrete px-3 py-2 text-sm">{tradeoff}</p>}
        </article>
      ) : (
        <article className="rounded-2xl bg-white p-4" aria-live="polite">
          <h3 className="tabular text-3xl font-semibold leading-tight">Walk there, {minLabel(plan.walkMin)}</h3>
          <p className="mt-1 text-sm text-fur-dark">
            {plan.options.length
              ? "Walking beats every bus that's running right now."
              : "No running bus gets you there from here right now."}{" "}
            Arrive {clockAfter(clock, plan.walkMin)}.
          </p>
          {deadlineLine}
        </article>
      )}

      {(others.length > 0 || top) && (
        <ul className="flex flex-col overflow-hidden rounded-2xl bg-white" aria-label="Other ways to go">
          {others.map((o) => (
            <li key={`${o.busId}-${o.board.stop.id}`} className="flex items-center gap-3 px-4 py-3">
              <RouteChip routeId={o.routeId} network={network} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">From {o.board.stop.name}</p>
                <p className="text-xs text-fur-dark">
                  {o.status === "relax" ? `Leave in ${Math.round(o.leaveInMin)} min` : o.status === "walk" ? "Leave now" : "Run for it"}
                </p>
              </div>
              <p className="tabular text-right text-sm">
                <span className="text-fur-dark">arrive </span>
                {about(o)}
                {clockAfter(clock, o.arriveInMin)}
              </p>
            </li>
          ))}
          {top && (
            <li className="flex items-center gap-3 px-4 py-3">
              <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-concrete text-xs font-semibold" aria-hidden="true">
                Walk
              </span>
              <p className="min-w-0 flex-1 text-sm font-medium">Walk all the way, {minLabel(plan.walkMin)}</p>
              <p className="tabular text-right text-sm">
                <span className="text-fur-dark">arrive </span>
                {clockAfter(clock, plan.walkMin)}
              </p>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
