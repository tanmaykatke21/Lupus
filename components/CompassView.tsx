"use client";

import { useEffect, useMemo, useState } from "react";
import { guide, phaseDone, phasesFor, turn, type Phase } from "@/lib/compass";
import { crowding } from "@/lib/crowding";
import { meters } from "@/lib/geo";
import type { RouteOption } from "@/lib/router";
import type { HeadingStatus } from "@/lib/useHeading";
import type { LngLat } from "@/lib/types";
import { countdown } from "@/lib/useNow";
import { announce, playWhistle } from "@/lib/voice";

interface Props {
  option: RouteOption;
  destination: string;
  location: LngLat | null;
  heading: number | null;
  headingStatus: HeadingStatus;
  now: number;
  voice: boolean;
  lang: string;
  onEnd: () => void;
}

const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 5) * 5} m`);
const walkMin = (m: number) => Math.max(1, Math.round(m / 1.3 / 60));

/** What to say/show for a phase: one clear instruction plus a detail line. */
function describe(p: Phase, location: LngLat | null, now: number) {
  switch (p.kind) {
    case "walk": {
      const remaining = location ? guide(p.line, location).remaining : null;
      return {
        title: `Walk to ${p.toLabel}`,
        detail: remaining === null ? "Finding your location…" : `${dist(remaining)} · about ${walkMin(remaining)} min`,
        spoken: `Walk to ${p.toLabel}.`,
      };
    }
    case "wait": {
      const left = p.departAt - now;
      return {
        title: left > 30_000 ? `Wait ${countdown(left)}` : "Board now",
        detail: `then take the ${p.routeName}${p.busId ? ` (bus ${p.busId})` : ""} from ${p.stopName}`,
        spoken: left > 60_000
          ? `Wait about ${Math.round(left / 60_000)} minutes for the ${p.routeName} at ${p.stopName}.`
          : `Board the ${p.routeName} now.`,
      };
    }
    case "ride": {
      const left = p.arriveAt - now;
      return {
        title: `Get off at ${p.alightName}`,
        detail: `${p.routeName} · ${p.stopCount} stop${p.stopCount === 1 ? "" : "s"} · ${left > 0 ? `about ${countdown(left)}` : "arriving"}`,
        spoken: `Ride the ${p.routeName} ${p.stopCount} stop${p.stopCount === 1 ? "" : "s"} and get off at ${p.alightName}.`,
      };
    }
    case "arrive":
      return { title: "You've arrived", detail: p.name, spoken: `You've arrived at ${p.name}. End of the line!` };
  }
}

function Dial({ needle, heading, mode }: { needle: number | null; heading: number | null; mode: Phase["kind"] }) {
  // The card (N/E/S/W) turns against the phone's heading; the needle points at the route.
  // Angles are kept continuous so the needle never spins the long way past north.
  const cardTarget = heading === null ? 0 : -heading;
  const [card, setCard] = useState(cardTarget);
  if (Math.abs(turn(card, cardTarget)) > 0.5) setCard(card + turn(card, cardTarget));
  const needleTarget = needle ?? 0;
  const [shown, setShown] = useState(needleTarget);
  if (Math.abs(turn(shown, needleTarget)) > 0.5) setShown(shown + turn(shown, needleTarget));

  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  return (
    <svg viewBox="-150 -150 300 300" className="h-auto w-[min(78vw,340px)]" role="img"
      aria-label={needle === null ? "Waiting for location" : `Head ${Math.round(((needle % 360) + 360) % 360)} degrees`}>
      <defs>
        <radialGradient id="face" cx="50%" cy="40%">
          <stop offset="0" stopColor="var(--surface)" />
          <stop offset="1" stopColor="var(--surface-2)" />
        </radialGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0c46a" />
          <stop offset=".5" stopColor="#a8781f" />
          <stop offset="1" stopColor="#5c4310" />
        </linearGradient>
      </defs>
      <circle r="146" fill="url(#rim)" />
      <circle r="132" fill="url(#face)" stroke="#5c4310" strokeWidth="1.5" />
      {[0, 90, 180, 270].map(a => (
        <circle key={a} r="3" fill="#5c4310" transform={`rotate(${a + 45}) translate(0 -139)`} />
      ))}
      <g style={{ transform: `rotate(${card}deg)`, transition: "transform 250ms linear" }}>
        {ticks.map(t => (
          <line key={t} y1={-128} y2={t % 30 === 0 ? -114 : -121} stroke="var(--muted)" strokeWidth={t % 90 === 0 ? 3 : 1.2} transform={`rotate(${t})`} />
        ))}
        {(["N", "E", "S", "W"] as const).map((d, i) => (
          <text key={d} transform={`rotate(${i * 90}) translate(0 -96) rotate(${-i * 90 - card})`} textAnchor="middle" dominantBaseline="central"
            className="font-display" fontSize="20" fontWeight="700" fill={d === "N" ? "var(--signal)" : "var(--ink)"}>{d}</text>
        ))}
      </g>
      {needle !== null && (
        <g style={{ transform: `rotate(${shown}deg)`, transition: "transform 400ms cubic-bezier(.3,1.4,.5,1)" }}>
          <path d="M0 -112 L20 -10 L0 -24 L-20 -10 Z" fill={mode === "ride" ? "var(--copper)" : "var(--signal)"} stroke="#1d150b" strokeWidth="2" />
          <path d="M0 -24 L20 -10 L0 60 L-20 -10 Z" fill="var(--iron)" opacity=".85" />
        </g>
      )}
      <circle r="12" fill="url(#rim)" stroke="#5c4310" />
    </svg>
  );
}

export default function CompassView({ option, destination, location, heading, headingStatus, now, voice, lang, onEnd }: Props) {
  const phases = useMemo(() => phasesFor(option, destination), [option, destination]);
  const [index, setIndex] = useState(0);
  const i = Math.min(index, phases.length - 1);
  const phase = phases[i];

  // Advance automatically when a phase is complete (adjusted during render).
  if (now && i < phases.length - 1 && phaseDone(phase, location, now)) setIndex(i + 1);

  const text = describe(phase, location, now);

  // Speak each new phase once; whistle when it's time to board.
  useEffect(() => {
    if (phase.kind === "wait" || phase.kind === "arrive") playWhistle();
    if (voice) announce(text.spoken, { lang });
    // Only on phase changes, not on every countdown tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Where the needle points.
  let target: number | null = null;
  let distanceLabel = "";
  if (location) {
    if (phase.kind === "walk") {
      const g = guide(phase.line, location);
      target = g.bearing;
      distanceLabel = g.offset > 40 ? `${dist(g.offset)} off route` : dist(g.remaining);
    } else if (phase.kind === "wait") {
      const away = meters(location, phase.stop);
      if (away > 25) { target = guide([location, phase.stop], location).bearing; distanceLabel = `stop is ${dist(away)} away`; }
    } else if (phase.kind === "ride") {
      target = guide([location, phase.alight], location).bearing;
      distanceLabel = dist(meters(location, phase.alight));
    }
  }
  // Relative to where the phone points (or north-up without a compass).
  const needle = target === null ? null : heading === null ? target : target - heading;

  const next = phases[i + 1];
  return (
    <div className="flex flex-1 flex-col items-center gap-4 px-4 pb-6" aria-live="polite">
      <div className="relative mt-2">
        <Dial needle={phase.kind === "arrive" ? null : needle} heading={heading} mode={phase.kind} />
        {phase.kind === "wait" && needle === null && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-2xl bg-surface/90 px-4 py-2 text-center font-display text-3xl font-bold tabular-nums">
              {phase.departAt > now ? countdown(phase.departAt - now) : "Now"}
            </span>
          </div>
        )}
        {phase.kind === "arrive" && <div className="absolute inset-0 grid place-items-center text-6xl" aria-hidden>🏁</div>}
      </div>

      {distanceLabel && <p className="-mt-2 font-display text-2xl font-bold tabular-nums">{distanceLabel}</p>}

      <section className="plate rivets w-full max-w-md rounded-2xl p-4 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted">Step {i + 1} of {phases.length}</p>
        <h2 className="mt-1 text-2xl font-bold leading-snug">{text.title}</h2>
        <p className="mt-1 text-muted">{text.detail}</p>
        {(phase.kind === "wait" || phase.kind === "ride") && (
          <span className="mt-2 inline-block rounded-md px-2 py-1 text-xs font-bold text-white" style={{ background: phase.color }}>
            🚌 {phase.routeName}{phase.kind === "wait" && phase.live ? " · live" : ""}
          </span>
        )}
        {phase.kind === "wait" && crowding(phase.load) && (
          <p className="mt-2 text-sm font-semibold">{crowding(phase.load)!.icon} {crowding(phase.load)!.label}</p>
        )}
      </section>

      {next && phase.kind !== "arrive" && (
        <p className="text-sm text-muted">Then: {describe(next, location, now).title}</p>
      )}

      {headingStatus === "unsupported" && phase.kind !== "arrive" && (
        <p className="max-w-md text-center text-xs text-muted">No compass on this device: the dial is north-up. Turn so the needle points ahead of you.</p>
      )}
      {headingStatus === "denied" && (
        <p className="max-w-md text-center text-xs text-warn">Motion access is off, so the dial is north-up. Allow motion &amp; orientation access for this site to turn it with your phone.</p>
      )}

      <div className="mt-auto grid w-full max-w-md grid-cols-3 gap-2">
        <button onClick={() => setIndex(Math.max(0, i - 1))} disabled={i === 0}
          className="h-12 rounded-xl border border-line text-sm font-medium disabled:opacity-40">◀ Back</button>
        {phase.kind === "wait" ? (
          <button onClick={() => setIndex(i + 1)} className="btn-brass h-12 rounded-xl text-sm font-bold">I&apos;m on 🚌</button>
        ) : phase.kind === "ride" ? (
          <button onClick={() => setIndex(i + 1)} className="btn-brass h-12 rounded-xl text-sm font-bold">I&apos;m off</button>
        ) : (
          <button onClick={() => setIndex(Math.min(phases.length - 1, i + 1))} disabled={phase.kind === "arrive"}
            className="h-12 rounded-xl border border-line text-sm font-medium disabled:opacity-40">Next ▶</button>
        )}
        <button onClick={onEnd} className="h-12 rounded-xl border border-line text-sm font-medium">End</button>
      </div>
    </div>
  );
}
