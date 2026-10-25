"use client";

import Gauge from "./Gauge";
import { crowding, skippedNote } from "@/lib/crowding";
import type { RouteOption } from "@/lib/router";
import { formatClock } from "@/lib/time";
import { countdown } from "@/lib/useNow";

interface Props {
  option: RouteOption;
  now: number;
  selected: boolean;
  fastest: boolean;
  onSelect: () => void;
}

const m = (n: number) => Math.max(1, Math.round(n));

export default function RouteCard({ option, now, selected, fastest, onSelect }: Props) {
  const bus = option.legs.find(l => l.type === "bus");
  const leaveIn = option.leaveBy - now;
  const slack = option.slackMinutes === null ? null : leaveIn / 60_000;
  const stairs = option.legs.some(l => l.type === "walk" && l.stairs);
  const crowd = bus?.type === "bus" ? crowding(bus.load) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`plate w-full rounded-2xl p-3 pl-4 text-left transition ${selected ? "ring-2 ring-brass" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tabular-nums">{m(option.totalMinutes)} min</span>
            {fastest && <span className="rounded-full bg-brass/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brass">Best</span>}
          </div>
          <p className="text-sm text-muted">
            {option.slackMinutes === null
              ? `Leave now · arrive ${formatClock(option.arriveAt)}`
              : `Leave by ${formatClock(option.leaveBy)} · arrive ${formatClock(option.arriveAt)}`}
          </p>
          {option.slackMinutes !== null && (
            <p className={`text-sm font-semibold ${leaveIn < 0 ? "text-danger" : "text-ink"}`} aria-live="off">
              {leaveIn < 0 ? `Should have left ${countdown(-leaveIn)} ago` : `Leave in ${countdown(leaveIn)}`}
            </p>
          )}
        </div>
        <Gauge slack={slack} size={60} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium">
        <span className="rounded-md bg-surface-2 px-2 py-1">🚶 {m(option.breakdown.walk)} min</span>
        {option.kind === "bus" && (
          <>
            <span className="rounded-md bg-surface-2 px-2 py-1">⏳ {Math.round(option.breakdown.wait)} min</span>
            <span className="rounded-md px-2 py-1 text-white" style={{ background: bus?.type === "bus" ? bus.color : undefined }}>
              🚌 {bus?.type === "bus" ? bus.routeName : "Bus"} · {m(option.breakdown.ride)} min
            </span>
          </>
        )}
        {bus?.type === "bus" && (bus.live
          ? <span className="text-ok">● live</span>
          : <span className="text-muted">{option.estimated ? "estimated" : "scheduled"}</span>)}
        {stairs && <span className="text-muted">· stairs</span>}
        {crowd && <span className={crowd.tone === "ok" ? "text-ok" : crowd.tone === "warn" ? "text-warn" : "text-danger"}>· {crowd.icon} {crowd.label}</span>}
      </div>
      {option.skippedFull && <p className="mt-1.5 text-xs font-semibold text-copper">🚫 {skippedNote(option.skippedFull)}</p>}
      {option.reliability && <p className="mt-1.5 text-xs text-copper">⏱ {option.reliability}</p>}
    </button>
  );
}
