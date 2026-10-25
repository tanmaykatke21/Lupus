"use client";

import { useSyncExternalStore } from "react";
import type { LocationStatus } from "@/lib/useLocation";

type Env = "insecure" | "in-app" | "ios-safari" | "ios-chrome" | "android" | "desktop";

function detect(): Env {
  if (!window.isSecureContext) return "insecure";
  const ua = navigator.userAgent;
  if (/Instagram|FBAN|FBAV|Snapchat|Line\/|LinkedInApp|TikTok/i.test(ua)) return "in-app";
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|EdgiOS|FxiOS/.test(ua) ? "ios-chrome" : "ios-safari";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

const STEPS: Record<Env, { why: string; steps: string[] }> = {
  insecure: {
    why: "This page isn't on a secure (https://) address, so your phone won't share location with it.",
    steps: ["Open the https:// link to Lupus (the Vercel one), not a local network address."],
  },
  "in-app": {
    why: "Browsers inside apps (Instagram, Snapchat…) often can't use location.",
    steps: ["Tap ⋯ or the share icon and choose Open in Safari / Open in browser.", "Then tap Guide me again."],
  },
  "ios-safari": {
    why: "iPhone has blocked location for websites, or for this site. Safari won't ask again until it's allowed.",
    steps: [
      "Settings → Privacy & Security → Location Services: turn it On.",
      "In the same list, Safari Websites → While Using the App, and turn on Precise Location.",
      "Back in Safari, tap the aA (or ⋯) button by the address → Website Settings → Location → Allow.",
      "Reload this page and tap Try again.",
    ],
  },
  "ios-chrome": {
    why: "iPhone has blocked location for Chrome.",
    steps: [
      "Settings → Privacy & Security → Location Services: On.",
      "Settings → Chrome → Location → While Using the App, with Precise Location on.",
      "Reload this page and tap Try again.",
    ],
  },
  android: {
    why: "Location is blocked for this site or for your browser.",
    steps: [
      "Tap the icon left of the address → Permissions (or Site settings) → Location → Allow.",
      "Make sure the phone's Location is on (swipe down → Location).",
      "Reload and tap Try again.",
    ],
  },
  desktop: {
    why: "Location is blocked for this site.",
    steps: ["Click the icon left of the address → Location → Allow, then reload."],
  },
};

const noop = () => () => {};

interface Props {
  status: LocationStatus;
  onRetry: () => void;
  onPickStart: () => void;
}

/** Explains why location isn't available on this device and how to fix it, with a manual fallback. */
export default function LocationHelp({ status, onRetry, onPickStart }: Props) {
  const env = useSyncExternalStore(noop, detect, () => "desktop" as Env);
  if (status !== "denied" && status !== "unavailable") return null;
  const info = status === "unavailable"
    ? { why: "Your phone couldn't get a location fix (indoors, or Location Services is off).", steps: ["Make sure Location Services is on, step near a window or outside, then tap Try again."] }
    : STEPS[env];

  return (
    <div role="alert" className="rounded-2xl border-2 border-warn bg-warn/10 p-4 text-left text-sm">
      <p className="font-bold">📍 Lupus can&apos;t see where you are</p>
      <p className="mt-1">{info.why}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {info.steps.map(s => <li key={s}>{s}</li>)}
      </ol>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onRetry} className="btn-brass h-11 rounded-full font-bold">Try again</button>
        <button onClick={onPickStart} className="h-11 rounded-full btn-glass font-semibold">Pick where I am</button>
      </div>
    </div>
  );
}
