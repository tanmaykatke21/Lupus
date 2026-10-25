"use client";

import { useRef, useState } from "react";
import { classStartsAt, nextClass, type ClassEntry } from "@/lib/classes";
import { PLACES, placeById } from "@/lib/places";
import { campusClock, formatClock, type DayKey } from "@/lib/time";
import { countdown } from "@/lib/useNow";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "M" }, { key: "tue", label: "Tu" }, { key: "wed", label: "W" },
  { key: "thu", label: "Th" }, { key: "fri", label: "F" }, { key: "sat", label: "Sa" }, { key: "sun", label: "Su" },
];
const ACADEMIC = PLACES.filter(p => ["academic", "services", "medical"].includes(p.category));

interface Props {
  classes: ClassEntry[];
  now: number;
  onChange: (c: ClassEntry[]) => void;
  onGo: (cls: ClassEntry, startsAt: number) => void;
}

const blank = (): ClassEntry => ({ id: `c${Date.now().toString(36)}`, course: "", days: [], start: "10:00", placeId: null });

function ClassEditor({ value, onChange, onRemove }: { value: ClassEntry; onChange: (c: ClassEntry) => void; onRemove: () => void }) {
  return (
    <fieldset className="space-y-2 card rounded-2xl p-3">
      <legend className="sr-only">{value.course || "New class"}</legend>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Course</span>
          <input value={value.course} onChange={e => onChange({ ...value, course: e.target.value })} placeholder="CSE 214"
            className="h-11 w-full rounded-lg bg-surface-2 px-3" />
        </label>
        <label>
          <span className="sr-only">Start time</span>
          <input type="time" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })}
            className="h-11 rounded-lg bg-surface-2 px-2" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
        {DAYS.map(d => {
          const on = value.days.includes(d.key);
          return (
            <button key={d.key} type="button" aria-pressed={on}
              onClick={() => onChange({ ...value, days: on ? value.days.filter(x => x !== d.key) : [...value.days, d.key] })}
              className={`h-10 min-w-10 rounded-lg border px-2 text-sm ${on ? "border-brass bg-brass/20 font-bold" : "border-line"}`}>
              {d.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Building</span>
          <select value={value.placeId ?? ""} onChange={e => onChange({ ...value, placeId: e.target.value || null })}
            className={`h-11 w-full rounded-lg border bg-surface-2 px-2 ${value.placeId ? "border-line" : "border-danger"}`}>
            <option value="">{value.building ? `Pick building for “${value.building}”` : "Pick building"}</option>
            {ACADEMIC.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={onRemove} className="h-11 rounded-lg px-3 text-sm text-danger" aria-label={`Remove ${value.course}`}>✕</button>
      </div>
    </fieldset>
  );
}

export default function ClassesPanel({ classes, now, onChange, onGo }: Props) {
  const [review, setReview] = useState<ClassEntry[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const next = now ? nextClass(classes, new Date(now), campusClock) : null;

  const importShot = async (file: File) => {
    setBusy(true);
    setStatus("Reading your schedule…");
    try {
      const form = new FormData();
      form.set("image", file);
      const res = await fetch("/api/schedule-ocr", { method: "POST", body: form });
      const body = await res.json();
      if (res.status === 503) throw new Error("Screenshot import needs the Gemini key. Add classes by hand below.");
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that image");
      if (!body.classes.length) throw new Error("No classes found in that image. Try a clearer screenshot.");
      setReview(body.classes);
      setStatus(`Found ${body.classes.length} classes. Check them, then save.`);
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (review) {
    const ok = review.every(c => c.course.trim() && c.days.length && c.placeId);
    return (
      <div className="space-y-3">
        <h2 className="font-display text-lg font-bold">Review classes</h2>
        {status && <p role="status" className="text-sm text-muted">{status}</p>}
        {review.map((c, i) => (
          <ClassEditor key={c.id} value={c}
            onChange={v => setReview(r => r!.map((x, j) => (j === i ? v : x)))}
            onRemove={() => setReview(r => r!.filter((_, j) => j !== i))} />
        ))}
        <div className="flex gap-2">
          <button disabled={!ok} onClick={() => { onChange([...classes, ...review]); setReview(null); setStatus("Saved."); }}
            className="btn-brass h-12 flex-1 rounded-full font-bold disabled:opacity-50">Save {review.length} classes</button>
          <button onClick={() => { setReview(null); setStatus(null); }} className="h-12 rounded-full btn-glass px-4">Cancel</button>
        </div>
        {!ok && <p className="text-xs text-danger">Every class needs a course, at least one day and a building.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {next ? (
        <button onClick={() => onGo(next.cls, classStartsAt(now, next.inMinutes))}
          className="plate flex w-full items-center gap-3 rounded-2xl p-4 text-left">
          <span className="text-3xl" aria-hidden>🎓</span>
          <span className="flex-1">
            <span className="block text-xs font-bold uppercase tracking-wide text-muted">Next class</span>
            <span className="block font-display text-lg font-bold">{next.cls.course}</span>
            <span className="block text-sm text-muted">
              {placeById(next.cls.placeId!)?.name} · starts in {countdown(next.inMinutes * 60_000)}
            </span>
          </span>
          <span className="btn-brass rounded-full px-3 py-2 text-sm font-bold">Go ▶</span>
        </button>
      ) : (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">Add your classes and Lupus will get you to the next one on time.</p>
      )}

      <div className="flex gap-2">
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="h-12 flex-1 rounded-xl border border-brass/60 bg-brass/10 text-sm font-semibold disabled:opacity-60">
          📸 Import SOLAR screenshot
        </button>
        <button onClick={() => setReview([blank()])} className="h-12 rounded-full btn-glass px-4 text-sm font-semibold">+ Add</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Schedule screenshot"
          onChange={e => e.target.files?.[0] && importShot(e.target.files[0])} />
      </div>
      {status && <p role="status" className="text-sm text-muted">{status}</p>}

      <ul className="space-y-2">
        {classes.map(c => (
          <li key={c.id} className="flex min-h-12 items-center gap-3 card rounded-2xl px-3 py-2">
            <span className="flex-1">
              <span className="block font-medium">{c.course}</span>
              <span className="block text-xs text-muted">
                {DAYS.filter(d => c.days.includes(d.key)).map(d => d.label).join(" ")} · {formatClock(Date.parse(`2026-01-05T${c.start}:00-05:00`))}
                {" · "}{c.placeId ? placeById(c.placeId)?.name : "no building"}{c.room ? ` ${c.room}` : ""}
              </span>
            </span>
            <button onClick={() => onChange(classes.filter(x => x.id !== c.id))} className="h-11 px-2 text-sm text-danger" aria-label={`Remove ${c.course}`}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
