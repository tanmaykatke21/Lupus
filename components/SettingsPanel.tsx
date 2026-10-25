"use client";

import Link from "next/link";
import { useState } from "react";
import { LANGUAGES } from "@/lib/languages";
import type { Settings } from "@/lib/storage";
import Icon from "./Icon";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  replay: boolean;
  onReplay: (on: boolean) => void;
  demoFull: boolean;
  onDemoFull: (on: boolean) => void;
}

export default function SettingsPanel({ settings, onChange, onClose, replay, onReplay, demoFull, onDemoFull }: Props) {
  const [taps, setTaps] = useState(0);
  const demo = taps >= 5 || replay || demoFull;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Settings</h2>
        <button onClick={onClose} className="h-11 rounded-full btn-glass px-4 text-sm font-medium">Done</button>
      </div>
      <div className="space-y-3">
        <label className="flex min-h-12 items-center justify-between gap-3 card rounded-2xl px-3 py-2">
          <span>
            <span className="block font-medium">Directions language</span>
            <span className="block text-xs text-muted">Steps are translated with Gemini and spoken aloud</span>
          </span>
          <select className="h-11 rounded-lg bg-surface-2 px-2" value={settings.language}
            onChange={e => onChange({ ...settings, language: e.target.value })}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 card rounded-2xl px-3 py-2">
          <span>
            <span className="block font-medium">Conductor voice</span>
            <span className="block text-xs text-muted">Speak steps and leave-by alerts</span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={settings.voice}
            onChange={e => onChange({ ...settings, voice: e.target.checked })} />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 card rounded-2xl px-3 py-2">
          <span>
            <span className="block font-medium">Accessible routes</span>
            <span className="block text-xs text-muted">Avoid stairs, assume a slower pace</span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={settings.accessible}
            onChange={e => onChange({ ...settings, accessible: e.target.checked })} />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 card rounded-2xl px-3 py-2">
          <span>
            <span className="block font-medium">Train buffer</span>
            <span className="block text-xs text-muted">Minutes to buy a ticket and reach the platform</span>
          </span>
          <select className="h-11 rounded-lg bg-surface-2 px-2" value={settings.trainBufferMin}
            onChange={e => onChange({ ...settings, trainBufferMin: Number(e.target.value) })}>
            {[2, 3, 5, 7, 10].map(n => <option key={n} value={n}>{n} min</option>)}
          </select>
        </label>
      </div>

      <Link href="/stats" className="mt-4 flex min-h-12 items-center justify-between card rounded-2xl px-3 font-medium">
        How accurate are bus ETAs? <Icon name="chevronRight" className="h-4 w-4 text-muted" />
      </Link>

      {demo && (
        <section className="mt-4 rounded-xl border border-dashed border-brass p-3" aria-label="Demo tools">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brass">Demo tools</p>
          <label className="flex min-h-12 items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Replay mode</span>
              <span className="block text-xs text-muted">Play recorded buses from Tiger Data as if live</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={replay} onChange={e => onReplay(e.target.checked)} />
          </label>
          <label className="flex min-h-12 items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Pretend the next bus is full</span>
              <span className="block text-xs text-muted">Shows how Lupus reroutes around a packed bus (labeled as a demo)</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={demoFull} onChange={e => onDemoFull(e.target.checked)} />
          </label>
        </section>
      )}

      {/* Tapping the version five times reveals the demo tools. */}
      <button onClick={() => setTaps(t => t + 1)} className="mt-6 w-full py-2 text-center text-xs text-muted">
        Lupus 0.1 · SBUHacks 2026
      </button>
    </div>
  );
}
