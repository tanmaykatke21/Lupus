"use client";

import { useSyncExternalStore } from "react";

// Phones and tablets: touch is the main input and nothing hovers. Laptops and desktops (touchscreen ones
// included, whose main pointer is still the trackpad or mouse) don't match. Those have no GPS or compass,
// so the compass view is phone-only.
const QUERY = "(hover: none) and (pointer: coarse)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True on phones and tablets. The server assumes a phone, matching the app's compass-first default. */
export function useHandheld() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => true);
}
