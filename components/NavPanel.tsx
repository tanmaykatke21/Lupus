"use client";

import { useEffect, useState } from "react";
import { clockAfter, minLabel } from "@/lib/campusClock";
import type { Bus } from "@/lib/etaspot";
import type { NavPlan, NavSnapshot } from "@/lib/navEngine";
import { distanceText } from "@/lib/navigation";
import type { Network } from "@/lib/network";
import { routeColor, routeLabel, routeName, textOn } from "@/lib/routes";

interface Props {
  plan: NavPlan;
  snapshot: NavSnapshot | null;
  demo: boolean;
  network: Network | null;
  buses: Bus[];
  /** When the bus data arrived, to keep the bus countdown running between updates. */
  receivedAt: number | null;
  /** Shift for clock times when showing saved sample data (see TripPanel). */
  clockShiftMs: number;
  onGotOff: () => void;
  onEnd: () => void;
}

/** Turn arrow angle: 0 points straight ahead. */
const ARROW_DEG: Record<string, number> = {
  "slight-left": -45,
  left: -90,
  "sharp-left": -135,
  "slight-right": 45,
  right: 90,
  "sharp-right": 135,
  "u-turn": 180,
};

function StepIcon({ kind }: { kind: NavSnapshot["stepKind"] }) {
  if (kind === "arrive") {
    return (
      <svg viewBox="0 0 24 24" className="size-9" aria-hidden="true">
        <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z" fill="currentColor" />
        <circle cx="12" cy="9" r="2.6" fill="var(--red)" />
      </svg>
    );
  }
  if (kind === "ride") {
    return (
      <svg viewBox="0 0 24 24" className="size-9" aria-hidden="true">
        <rect x="4" y="3" width="16" height="15" rx="3" fill="currentColor" />
        <rect x="6.5" y="6" width="11" height="5" rx="1" fill="var(--navy)" />
        <circle cx="8" cy="15" r="1.4" fill="var(--navy)" />
        <circle cx="16" cy="15" r="1.4" fill="var(--navy)" />
        <rect x="6" y="18" width="3" height="3" rx="1" fill="currentColor" />
        <rect x="15" y="18" width="3" height="3" rx="1" fill="currentColor" />
      </svg>
    );
  }
  const deg = kind ? (ARROW_DEG[kind] ?? 0) : 0;
  return (
    <svg viewBox="0 0 24 24" className="size-9" aria-hidden="true" style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M12 3 5 11h4.5v10h5V11H19z" fill="currentColor" />
    </svg>
  );
}

export default function NavPanel({ plan, snapshot, demo, network, buses, receivedAt, clockShiftMs, onGotOff, onEnd }: Props) {
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

  const s = snapshot;
  const phase = s?.phase ?? (plan.bus ? "to-stop" : "walk");
  const clock = (now ?? 0) + clockShiftMs;

  // The bus being caught: minutes until it reaches the boarding stop, aged since the data arrived.
  const bus = plan.bus ? buses.find((b) => b.id === plan.bus!.busId) : undefined;
  const boardIn = (() => {
    if (!plan.bus || !bus || now === null || receivedAt === null) return null;
    const u = bus.upcoming.find((x) => x.stopId === plan.bus!.boardStopId);
    return u ? Math.max(0, u.minutes - (now - receivedAt) / 60_000) : null;
  })();
  const color = plan.bus ? routeColor(plan.bus.routeId, network) : "#262840";

  const steps = plan.bus
    ? [
        { id: "to-stop", label: `Walk to ${plan.bus.board.name}` },
        { id: "ride", label: `Ride ${routeLabel(plan.bus.routeId, network)}` },
        { id: "walk", label: `Walk to ${plan.destination.name}` },
      ]
    : null;
  const stepIndex = phase === "to-stop" ? 0 : phase === "ride" ? 1 : 2;
  const arrived = phase === "arrived";

  return (
    <div className="flex flex-col gap-2" aria-label="Navigation">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold text-fur-dark">
          {demo ? "Demo walk" : "Navigating"} to {plan.destination.name}
        </p>
        <button type="button" onClick={onEnd} className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold hover:bg-concrete">
          {arrived ? "Done" : "End"}
        </button>
      </div>

      {/* The instruction: big, high-contrast, glanceable while walking */}
      <article
        aria-live="polite"
        className={`flex items-center gap-3 rounded-2xl p-4 text-white ${s?.offRoute ? "bg-red" : "bg-navy"}`}
      >
        <span className="shrink-0">
          <StepIcon kind={s?.stepKind ?? null} />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-tight">{s?.instruction ?? "Finding your location"}</p>
          {!arrived && s && s.stepKind !== "ride" && (
            <p className="mt-0.5 truncate text-sm text-white/75">toward {s.targetName}</p>
          )}
        </div>
      </article>

      {s && !arrived && s.remainingM !== null && phase !== "ride" && (
        <p className="tabular px-1 text-sm">
          <span className="font-semibold">{minLabel(s.remainingMin ?? 0)}</span>
          <span className="text-fur-dark">
            {" "}
            · {distanceText(s.remainingM)} · arrive {clockAfter(clock, s.remainingMin ?? 0)}
          </span>
        </p>
      )}

      {phase === "ride" && plan.bus && (
        <article className="rounded-2xl bg-white p-4">
          <div className="flex items-center gap-2">
            <span
              className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg px-1.5 text-xs font-semibold"
              style={{ background: color, color: textOn(color) }}
            >
              {routeLabel(plan.bus.routeId, network)}
            </span>
            <p className="font-medium">{routeName(plan.bus.routeId, network)}</p>
          </div>
          <p className="mt-2 text-sm">
            {boardIn === null
              ? `Board at ${plan.bus.board.name}.`
              : boardIn < 0.5
                ? `The bus is at ${plan.bus.board.name} now.`
                : `Bus reaches ${plan.bus.board.name} in ${minLabel(boardIn)}, at ${clockAfter(clock, boardIn)}.`}{" "}
            Get off at <span className="font-semibold">{plan.bus.alight.name}</span>
            {s?.remainingM != null && `, ${distanceText(s.remainingM)} away`}.
          </p>
          <button
            type="button"
            onClick={onGotOff}
            className="mt-3 w-full rounded-full bg-navy px-4 py-2.5 text-sm font-semibold text-white"
          >
            I&apos;m off the bus
          </button>
        </article>
      )}

      {phase === "to-stop" && boardIn !== null && (
        <p className="px-1 text-sm text-fur-dark">
          Your bus reaches {plan.bus!.board.name} in {minLabel(boardIn)}.
        </p>
      )}

      {steps && (
        <ol className="flex gap-1.5 px-1" aria-label="Trip steps">
          {steps.map((st, i) => (
            <li
              key={st.id}
              aria-current={i === stepIndex && !arrived ? "step" : undefined}
              className={`min-w-0 flex-1 truncate rounded-full px-2.5 py-1 text-center text-xs font-medium ${
                arrived || i < stepIndex ? "bg-concrete text-fur" : i === stepIndex ? "bg-white text-navy" : "bg-white/50 text-fur-dark"
              }`}
            >
              {st.label}
            </li>
          ))}
        </ol>
      )}

      {s?.notice && <p className="rounded-xl bg-white px-3 py-2 text-sm text-fur-dark">{s.notice}</p>}
    </div>
  );
}
