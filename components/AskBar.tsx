"use client";

import { useState } from "react";
import type { AskAction } from "@/lib/ask";
import type { ClassEntry } from "@/lib/classes";
import { searchPlaces } from "@/lib/places";

interface Props {
  classes: ClassEntry[];
  onAction: (a: AskAction) => void;
}

const EXAMPLES = ["closest coffee", "get me to the 6pm train to the city", "my CSE 214 lecture"];

export default function AskBar({ classes, onAction }: Props) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setReply(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, classes: classes.map(c => ({ id: c.id, course: c.course, title: c.title })) }),
      });
      if (res.status === 503) {
        // Gemini not configured: plain place search still gets people moving.
        const hit = searchPlaces(text)[0];
        if (hit) onAction({ type: "place", placeId: hit.id, reply: "" });
        else setReply("Try a building name, like “Javits” or “SAC”.");
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const action = body.action as AskAction;
      if (action.type === "none") setReply(action.reply);
      else onAction(action);
    } catch {
      setReply("The conductor couldn't answer just now. Try searching instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      <form onSubmit={e => { e.preventDefault(); submit(q); }} className="flex gap-2">
        <label htmlFor="ask" className="sr-only">Ask the conductor</label>
        <input
          id="ask"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Ask: “6pm train to the city”"
          enterKeyHint="go"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base placeholder:text-muted"
        />
        <button disabled={busy} className="btn-brass h-12 rounded-xl px-4 font-bold disabled:opacity-60" aria-label="Ask">
          {busy ? "…" : "Ask"}
        </button>
      </form>
      {reply && <p role="status" className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">🎩 {reply}</p>}
      {!q && !reply && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {EXAMPLES.map(e => (
            <button key={e} onClick={() => { setQ(e); submit(e); }} className="min-h-9 shrink-0 rounded-full border border-line px-3 text-xs text-muted">
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
