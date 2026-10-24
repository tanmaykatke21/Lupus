"use client";

// Spoken output: Gemini translation → ElevenLabs clip (CDN-cached GET) → browser speech fallback.
import { speechLang, VOICE_VERSION } from "./languages";
import { voiceHash } from "./voiceHash";

export interface SpeakOptions {
  lang?: string;
}

// iOS only lets audio play after a user gesture. "Start navigation" calls unlockAudio(),
// and every later clip reuses these same elements.
let voiceEl: HTMLAudioElement | null = null;
let fxEl: HTMLAudioElement | null = null;
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export function unlockAudio() {
  if (typeof window === "undefined") return;
  voiceEl ??= new Audio();
  fxEl ??= new Audio();
  for (const el of [voiceEl, fxEl]) {
    el.src = SILENCE;
    el.play().catch(() => {});
  }
  if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}

export function stopSpeaking() {
  voiceEl?.pause();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function speakWithBrowser(text: string, { lang = "en" }: SpeakOptions = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  return new Promise<void>(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(lang);
    u.rate = 1.02;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

// --- translation ---

const translated = new Map<string, string>();
let translationBroken = false;

/** Translates lines with Gemini; returns the originals if translation is unavailable. */
export async function translateLines(texts: string[], lang: string): Promise<{ lines: string[]; translated: boolean }> {
  if (lang === "en" || translationBroken || texts.length === 0) return { lines: texts, translated: lang === "en" };
  const missing = texts.filter(t => !translated.has(`${lang}|${t}`));
  if (missing.length) {
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: missing, lang }),
      });
      if (res.status === 503) translationBroken = true; // not configured: stop asking
      if (!res.ok) return { lines: texts, translated: false };
      const { lines } = (await res.json()) as { lines: string[] };
      missing.forEach((t, i) => translated.set(`${lang}|${t}`, lines[i]));
    } catch {
      return { lines: texts, translated: false };
    }
  }
  return { lines: texts.map(t => translated.get(`${lang}|${t}`) ?? t), translated: true };
}

// --- speech ---

let elevenLabsDown = false;
let seq = 0;

async function playClip(text: string, lang: string) {
  const h = await voiceHash(text, lang, VOICE_VERSION);
  const url = `/api/voice?${new URLSearchParams({ lang, v: VOICE_VERSION, h, text })}`;
  const res = await fetch(url);
  if (res.status === 503) elevenLabsDown = true;
  if (!res.ok) throw new Error(`voice ${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  voiceEl ??= new Audio();
  voiceEl.src = blobUrl;
  await new Promise<void>((resolve, reject) => {
    voiceEl!.onended = () => { URL.revokeObjectURL(blobUrl); resolve(); };
    voiceEl!.onerror = () => reject(new Error("playback failed"));
    voiceEl!.play().catch(reject);
  });
}

/** Speaks already-localized text. Newer calls interrupt older ones. */
export async function speak(text: string, { lang = "en" }: SpeakOptions = {}) {
  const mine = ++seq;
  stopSpeaking();
  if (!elevenLabsDown) {
    try {
      await playClip(text, lang);
      return;
    } catch {
      if (mine !== seq) return; // superseded while loading
    }
  }
  await speakWithBrowser(text, { lang });
}

/** Translate (if needed) and speak. */
export async function announce(text: string, opts: SpeakOptions = {}) {
  const lang = opts.lang ?? "en";
  const { lines } = await translateLines([text], lang);
  await speak(lines[0], { lang });
}

// --- steam whistle ---

let whistleMissing = false;

// Two-tone "steam whistle" synthesized with Web Audio, used until public/sounds/whistle.mp3 exists.
function synthWhistle() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const out = ctx.createGain();
  out.gain.value = 0.18;
  out.connect(ctx.destination);
  const blast = (start: number, dur: number) => {
    for (const f of [587, 740, 880]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f * 0.97, ctx.currentTime + start);
      osc.frequency.linearRampToValueAtTime(f, ctx.currentTime + start + 0.12);
      g.gain.setValueAtTime(0, ctx.currentTime + start);
      g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + start + 0.08);
      g.gain.setValueAtTime(0.3, ctx.currentTime + start + dur - 0.15);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.connect(g).connect(out);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    }
  };
  blast(0, 0.55);
  blast(0.7, 0.9);
  setTimeout(() => ctx.close(), 2000);
}

export async function playWhistle() {
  if (typeof window === "undefined") return;
  if (!whistleMissing) {
    try {
      fxEl ??= new Audio();
      fxEl.src = "/sounds/whistle.mp3";
      await fxEl.play();
      return;
    } catch {
      whistleMissing = true;
    }
  }
  synthWhistle();
}
