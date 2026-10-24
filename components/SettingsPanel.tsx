"use client";

import type { Settings } from "@/lib/storage";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Settings</h2>
        <button onClick={onClose} className="h-11 rounded-xl border border-line px-4 text-sm font-medium">Done</button>
      </div>
      <div className="space-y-3">
        <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2">
          <span>
            <span className="block font-medium">Accessible routes</span>
            <span className="block text-xs text-muted">Avoid stairs, assume a slower pace</span>
          </span>
          <input type="checkbox" className="h-6 w-6 accent-[var(--brass)]" checked={settings.accessible}
            onChange={e => onChange({ ...settings, accessible: e.target.checked })} />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2">
          <span>
            <span className="block font-medium">Train buffer</span>
            <span className="block text-xs text-muted">Minutes to buy a ticket and reach the platform</span>
          </span>
          <select className="h-11 rounded-lg border border-line bg-surface-2 px-2" value={settings.trainBufferMin}
            onChange={e => onChange({ ...settings, trainBufferMin: Number(e.target.value) })}>
            {[2, 3, 5, 7, 10].map(n => <option key={n} value={n}>{n} min</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
