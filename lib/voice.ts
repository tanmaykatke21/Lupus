"use client";

// Speaks short announcements. Phase 6 routes this through ElevenLabs; until a clip is
// available it falls back to the browser's speech engine.
export interface SpeakOptions {
  lang?: string;
}

export function speakWithBrowser(text: string, { lang = "en" }: SpeakOptions = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1.02;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export async function announce(text: string, opts: SpeakOptions = {}) {
  speakWithBrowser(text, opts);
}
