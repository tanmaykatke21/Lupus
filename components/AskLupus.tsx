"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { AgentAnswer, AnswerCard, Verdict } from "@/lib/agent/run";
import { announce } from "@/lib/voice";

export type AgentResponse = AgentAnswer & { mode: "gemini" | "mock" };

interface Props {
  current: { lat: number; lng: number; label: string } | null;
  accessible: boolean;
  voice: boolean;
  lang: string;
  onGuide: (card: AnswerCard) => void;
  onShowMap: (card: AnswerCard) => void;
}

const VERDICT: Record<Verdict, { label: string; cls: string } | null> = {
  yes: { label: "You'll make it", cls: "bg-ok text-white" },
  tight: { label: "Tight: walk fast", cls: "bg-warn text-[#1d150b]" },
  no: { label: "You'll be late", cls: "bg-danger text-white" },
  info: null,
  need_info: { label: "One question", cls: "bg-surface-2 text-ink" },
};

const STEP_LABEL: Record<string, string> = {
  find_place: "found place", plan_trip: "planned trip", lirr_departures: "checked trains", catch_train: "timed the train",
  bus_status: "checked buses", stop_departures: "checked stop", show_answer: "answered",
};

// Minimal typing for the browser speech API.
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
}
type SpeechCtor = new () => SpeechRec;
const speechCtor = (): SpeechCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const EXAMPLES = ["I'm at West Apartments, lab in Life Sciences at 2. Will I make it?", "Get me to the next train to the city", "Fastest way from SAC to Chapin?"];

function bufferLine(card: AnswerCard) {
  if (card.bufferMin === null || !card.deadline) return null;
  const m = Math.abs(card.bufferMin);
  if (card.bufferMin >= 1) return `${m} min to spare before ${card.deadline}`;
  if (card.bufferMin >= 0) return `Right on time for ${card.deadline}`;
  return `About ${m} min late for ${card.deadline}`;
}

const noop = () => () => {};

export default function AskLupus({ current, accessible, voice, lang, onGuide, onShowMap }: Props) {
  // False on the server and during hydration, so the mic button can't cause a mismatch.
  const canListen = useSyncExternalStore(noop, () => !!speechCtor(), () => false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question, current, accessible,
          // One-turn memory so a follow-up like "from SAC" has context.
          previous: answer ? { question: asked, answer: answer.message } : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Ask Lupus failed");
      setAnswer(body);
      setAsked(question);
      setQ("");
      if (voice && body.message) announce(body.message, { lang });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    const Ctor = speechCtor();
    if (!Ctor || listening) return;
    const rec = new Ctor();
    rec.lang = lang === "en" ? "en-US" : lang;
    rec.interimResults = false;
    rec.onresult = e => { const t = e.results[0][0].transcript; setQ(t); ask(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const badge = answer ? VERDICT[answer.verdict] : null;
  const card = answer?.card;

  return (
    <section aria-label="Ask Lupus" className="plate rivets rounded-2xl p-3">
      <form onSubmit={e => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <label htmlFor="ask-lupus" className="sr-only">Ask Lupus</label>
        <input id="ask-lupus" value={q} onChange={e => setQ(e.target.value)} enterKeyHint="send"
          placeholder={answer?.verdict === "need_info" ? "Reply…" : "Ask: “Will I make my 2pm lab?”"}
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base placeholder:text-muted" />
        {canListen && (
          <button type="button" onClick={listen} aria-label="Ask by voice" aria-pressed={listening}
            className={`h-12 w-12 shrink-0 rounded-xl border border-line text-lg ${listening ? "bg-danger/20" : ""}`}>🎙</button>
        )}
        <button disabled={busy} className="btn-brass h-12 shrink-0 rounded-xl px-4 font-bold disabled:opacity-60">{busy ? "…" : "Ask"}</button>
      </form>

      {!answer && !busy && !error && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {EXAMPLES.map(e => (
            <button key={e} onClick={() => ask(e)} className="min-h-9 shrink-0 rounded-full border border-line px-3 text-xs text-muted">{e}</button>
          ))}
        </div>
      )}
      {busy && <p role="status" className="mt-3 text-sm text-muted">🎩 The conductor is checking the timetables…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {answer && !busy && (
        <div className="mt-3" aria-live="polite">
          {badge && <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${badge.cls}`}>{badge.label}</span>}
          <p className="mt-2 text-base">🎩 {answer.message}</p>

          {card && (
            <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
              {card.kind === "bus" ? (
                <>
                  <p className="font-display text-xl font-bold">{card.slackMin > 0 ? `Leave by ${card.leaveBy}` : "Leave now"}</p>
                  <p className="mt-1">🚌 {card.route} from {card.boardStop}, bus at {card.busAt}</p>
                  <p className="text-muted">Get off at {card.alightStop}. Arrive <b className="text-ink">{card.arriveAt}</b>.</p>
                </>
              ) : (
                <p>🚶 Walk from {card.fromName} to {card.toName}. Arrive <b>{card.arriveAt}</b>.</p>
              )}
              {bufferLine(card) && <p className={`mt-1 font-semibold ${card.bufferMin! < 0 ? "text-danger" : ""}`}>{bufferLine(card)}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => onGuide(card)} className="btn-brass h-11 rounded-xl font-bold">🧭 Guide me</button>
                <button onClick={() => onShowMap(card)} className="h-11 rounded-xl border border-line font-semibold">🗺 Show on map</button>
              </div>
            </div>
          )}

          <p className="mt-2 text-xs text-muted">
            {answer.mode === "mock" ? "Offline mode (no Gemini): simple from/to questions only. " : ""}
            How Lupus worked this out: {answer.steps.map(s => STEP_LABEL[s] ?? s).join(" → ")}. Times come from our planner, not the AI.
          </p>
        </div>
      )}
    </section>
  );
}
