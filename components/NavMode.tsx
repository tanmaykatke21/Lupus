"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { busApproaching, conductorIntro, conductorLine } from "@/lib/conductor";
import { meters } from "@/lib/geo";
import type { RouteOption } from "@/lib/router";
import { stepsFor, type Step } from "@/lib/steps";
import type { LngLat } from "@/lib/types";
import { countdown } from "@/lib/useNow";
import { playWhistle, speak, stopSpeaking, translateLines } from "@/lib/voice";

const ICON: Record<Step["icon"], string> = { walk: "🚶", wait: "⏳", bus: "🚌", arrive: "🏁", shortcut: "🚪" };
const ARRIVE_RADIUS_M = 20;
const WHISTLE_AT_MS = 2 * 60_000;

interface Props {
  option: RouteOption;
  destination: string;
  lang: string;
  voice: boolean;
  now: number;
  location: LngLat | null;
  onExit: () => void;
}

export default function NavMode({ option, destination, lang, voice, now, location, onExit }: Props) {
  const steps = useMemo(() => stepsFor(option, destination), [option, destination]);
  const [index, setIndex] = useState(0);
  const [lines, setLines] = useState<{ text: string[]; translated: boolean } | null>(null);
  const [muted, setMuted] = useState(!voice);
  const spoken = useRef(new Set<number>());
  const whistled = useRef(false);

  const english = useMemo(() => [conductorIntro(option, destination), ...steps.map(conductorLine)], [option, destination, steps]);

  // Localize once per route/language. The intro is line 0.
  useEffect(() => {
    let stale = false;
    translateLines(english, lang).then(r => { if (!stale) setLines({ text: r.lines, translated: r.translated }); });
    return () => { stale = true; };
  }, [english, lang]);

  const lineFor = (i: number) => lines?.text[i + 1] ?? english[i + 1];
  const step = steps[index];

  // Speak the intro + first step, then each new step once.
  useEffect(() => {
    if (muted || !lines || spoken.current.has(index)) return;
    spoken.current.add(index);
    const text = index === 0 ? `${lines.text[0]} ${lines.text[1]}` : lines.text[index + 1];
    speak(text, { lang: lines.translated ? lang : "en" });
  }, [index, lines, muted, lang]);

  useEffect(() => () => stopSpeaking(), []);

  // Auto-advance (walk steps by location, bus steps by clock), adjusted during render.
  const reached = !!step && index < steps.length - 1 && (
    (!!step.end && !!location && meters(location, step.end) < ARRIVE_RADIUS_M) ||
    (!!step.until && now > step.until + 30_000));
  if (reached) setIndex(index + 1);

  // Whistle when the bus is about two minutes out and we haven't boarded yet.
  const bus = option.legs.find(l => l.type === "bus");
  const boardIndex = steps.findIndex(s => s.icon === "bus");
  const untilBus = bus?.type === "bus" ? bus.departAt - now : null;
  useEffect(() => {
    if (untilBus === null || whistled.current || index > boardIndex) return;
    if (untilBus > 0 && untilBus <= WHISTLE_AT_MS && bus?.type === "bus") {
      whistled.current = true;
      playWhistle();
      if (!muted) {
        translateLines([busApproaching(bus.routeName, untilBus / 60_000)], lang)
          .then(r => speak(r.lines[0], { lang: r.translated ? lang : "en" }));
      }
    }
  }, [untilBus, index, boardIndex, bus, muted, lang]);

  const repeat = () => {
    if (!lines) return;
    speak(lines.text[index + 1], { lang: lines.translated ? lang : "en" });
  };

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">Step {index + 1} of {steps.length}</p>
        <button onClick={onExit} className="h-11 rounded-xl border border-line px-4 text-sm font-medium">End</button>
      </div>

      <div className="plate rivets rounded-2xl p-4">
        <div className="mb-2 text-4xl" aria-hidden>{ICON[step.icon]}</div>
        <p className="text-2xl font-bold leading-snug">{lineFor(index)}</p>
        {lines?.translated && lang !== "en" && <p className="mt-1 text-sm text-muted">{step.text}</p>}
        {step.detail && <p className="mt-2 text-sm text-muted">{step.detail}</p>}
        {untilBus !== null && index <= boardIndex && (
          <p className={`mt-3 text-lg font-bold tabular-nums ${untilBus < WHISTLE_AT_MS ? "text-danger" : "text-copper"}`}>
            {untilBus > 0 ? `Bus in ${countdown(untilBus)}` : "Bus is due"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
          className="h-12 rounded-xl border border-line text-sm font-medium disabled:opacity-40" aria-label="Previous step">◀</button>
        <button onClick={repeat} className="h-12 rounded-xl border border-line text-sm font-medium" aria-label="Repeat step">🔁</button>
        <button onClick={() => { setMuted(m => !m); stopSpeaking(); }} aria-pressed={muted}
          className="h-12 rounded-xl border border-line text-sm font-medium" aria-label={muted ? "Unmute voice" : "Mute voice"}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button onClick={() => setIndex(i => Math.min(steps.length - 1, i + 1))} disabled={index === steps.length - 1}
          className="btn-brass h-12 rounded-xl text-sm font-bold disabled:opacity-40" aria-label="Next step">▶</button>
      </div>

      <ol className="space-y-1 text-sm">
        {steps.map((s, i) => (
          <li key={i} className={`rounded-lg px-2 py-1 ${i === index ? "bg-brass/15 font-semibold" : i < index ? "text-muted line-through" : ""}`}>
            {ICON[s.icon]} {lineFor(i)}
          </li>
        ))}
      </ol>
    </div>
  );
}
