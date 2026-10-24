"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentAnswer, AnswerCard, Verdict } from "@/lib/agent/run";
import type { LatLng } from "@/lib/geo";
import type { Network } from "@/lib/network";
import { routeColor, routeLabel, textOn } from "@/lib/routes";

export type AgentResponse = AgentAnswer & { mode: "gemini" | "mock"; dataSource: "live" | "sample" };

/** The last exchange, kept by the parent so it survives closing the panel. */
export interface AskState {
  asked: string;
  answer: AgentResponse;
}

interface Props {
  /** Restores the last answer when the panel reopens. */
  saved: AskState | null;
  onSaved: (state: AskState) => void;
  network: Network | null;
  /** Where the rider is, when the app knows (GPS on campus or a start they picked). */
  current: (LatLng & { label: string }) | null;
  onClose: () => void;
  /** Hand the trip to the live planner on the main screen. */
  onShowTrip: (card: AnswerCard) => void;
}


/** Example questions; the class time is the next whole hour so the example is always answerable. */
function examples(nowMs: number): string[] {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(nowMs));
  const next = (hour + 1) % 24;
  const label = `${next % 12 === 0 ? 12 : next % 12}${next < 12 ? "am" : "pm"}`;
  return [`I'm at West Apartments, lab in Life Sciences at ${label}. Will I make it?`, "Fastest way from SAC to Chapin Apartments?"];
}

export const VERDICT: Record<Verdict, { label: string; cls: string } | null> = {
  yes: { label: "You'll make it", cls: "bg-navy text-white" },
  tight: { label: "Tight", cls: "bg-lane text-navy" },
  no: { label: "You'll be late", cls: "bg-red text-white" },
  info: null,
  need_info: { label: "One question", cls: "bg-concrete text-navy" },
};

const STEP_LABEL: Record<string, string> = {
  find_place: "find place",
  plan_trip: "plan trip",
  bus_status: "check buses",
  stop_departures: "check stop",
  show_answer: "answer",
};

// Minimal typing for the browser speech API (not in TypeScript's DOM library yet).
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechCtor = new () => SpeechRec;
function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function bufferLine(card: AnswerCard): string | null {
  if (card.bufferMin === null || !card.deadline) return null;
  const m = Math.round(Math.abs(card.bufferMin));
  if (card.bufferMin >= 0.5) return `${m} min to spare before ${card.deadline}`;
  if (card.bufferMin > -0.5) return `Right on time for ${card.deadline}`;
  return `About ${m} min late for ${card.deadline}`;
}

function TripSummary({ card, network }: { card: AnswerCard; network: Network | null }) {
  const color = card.routeId !== null ? routeColor(card.routeId, network) : "#262840";
  const buffer = bufferLine(card);
  return (
    <div className="mt-3 rounded-xl bg-concrete p-3">
      {card.mode === "bus" ? (
        <>
          <p className="tabular text-2xl font-semibold leading-tight">
            {card.pace === "relax" ? `Leave in ${Math.round(card.leaveInMin)} min` : card.pace === "walk" ? "Leave now" : "Run for it"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md px-1.5 text-xs font-semibold"
              style={{ background: color, color: textOn(color) }}
              aria-hidden="true"
            >
              {card.routeId !== null ? routeLabel(card.routeId, network) : ""}
            </span>
            <p className="text-sm font-medium">
              {card.routeName} from {card.boardStop}, bus at {card.busArrivesAt}
            </p>
          </div>
          <p className="mt-1 text-sm text-fur-dark">
            Get off at {card.alightStop}. Arrive {card.estimated ? "about " : ""}
            <span className="font-semibold text-navy">{card.arriveAt}</span>.
          </p>
        </>
      ) : (
        <p className="text-sm">
          Walk from {card.fromName} to {card.toName}. Arrive <span className="font-semibold">{card.arriveAt}</span>.
        </p>
      )}
      {buffer && <p className={`mt-2 text-sm font-medium ${card.bufferMin! < 0 ? "text-red-deep" : ""}`}>{buffer}</p>}
    </div>
  );
}

export default function AskLupus({ saved, onSaved, network, current, onClose, onShowTrip }: Props) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AgentResponse | null>(saved?.answer ?? null);
  const [asked, setAsked] = useState<string>(saved?.asked ?? "");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [exampleList, setExampleList] = useState<string[]>([]);
  const rec = useRef<SpeechRec | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Feature-detect after mount; the server render can't know.
    const t = setTimeout(() => {
      setCanSpeak(Boolean(speechCtor()));
      setExampleList(examples(Date.now()));
    }, 0);
    input.current?.focus();
    return () => {
      clearTimeout(t);
      rec.current?.stop();
    };
  }, []);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text) {
      setError("Type a question first.");
      return;
    }
    setAsking(true);
    setError(null);
    // A follow-up (like answering "where are you starting?") carries the previous exchange.
    const previous = answer && answer.verdict === "need_info" ? { question: asked, answer: answer.message } : null;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, current, previous }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Lupus responded ${res.status}`);
      const nextAsked = previous ? `${asked} ${text}` : text;
      setAnswer(body as AgentResponse);
      setAsked(nextAsked);
      onSaved({ asked: nextAsked, answer: body as AgentResponse });
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setAsking(false);
    }
  };

  const listen = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => {
      const said = e.results[0][0].transcript;
      setQuestion(said);
      ask(said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      setError("Didn't catch that. Try again or type your question.");
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const verdict = answer ? VERDICT[answer.verdict] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xl font-semibold">Ask Lupus</h2>
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white">
          Close
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="rounded-2xl bg-white p-3"
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-input"
          ref={input}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={2}
          maxLength={400}
          placeholder={answer?.verdict === "need_info" ? "Your answer" : "Where are you, where are you going, and by when?"}
          className="w-full resize-none bg-transparent text-base placeholder:text-fur focus:outline-none"
        />
        {error && <p className="mt-1 text-sm text-red-deep">{error}</p>}
        <div className="mt-2 flex items-center justify-end gap-2">
          {canSpeak && (
            <button
              type="button"
              onClick={listen}
              aria-pressed={listening}
              className={`rounded-full px-3 py-2 text-sm font-medium ${listening ? "bg-red text-white" : "bg-concrete text-navy"}`}
            >
              {listening ? "Listening" : "Speak"}
            </button>
          )}
          <button
            type="submit"
            disabled={asking}
            className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {asking ? "Checking buses" : "Ask"}
          </button>
        </div>
      </form>

      {!answer && !asking && (
        <ul className="flex flex-col gap-2" aria-label="Example questions">
          {exampleList.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(ex);
                  ask(ex);
                }}
                className="w-full rounded-2xl bg-white/70 px-4 py-3 text-left text-sm hover:bg-white"
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      )}

      {answer && (
        <article className="rounded-2xl bg-white p-4" aria-live="polite">
          {asked && <p className="mb-2 text-sm text-fur-dark">&ldquo;{asked}&rdquo;</p>}
          {verdict && (
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${verdict.cls}`}>{verdict.label}</span>
          )}
          <p className="mt-2 text-lg font-medium leading-snug">{answer.message}</p>
          {answer.card && <TripSummary card={answer.card} network={network} />}
          {answer.card && (
            <button
              type="button"
              onClick={() => onShowTrip(answer.card!)}
              className="mt-3 w-full rounded-full bg-navy px-4 py-2.5 text-sm font-semibold text-white"
            >
              Show on map
            </button>
          )}
          <p className="mt-3 text-xs text-fur-dark">
            Worked out with: {answer.steps.map((s) => STEP_LABEL[s] ?? s).join(", ")}.
            {answer.mode === "mock" && " Demo mode: answered without Gemini."}
            {answer.dataSource === "sample" && " Using saved sample bus data."}
          </p>
        </article>
      )}
    </div>
  );
}
