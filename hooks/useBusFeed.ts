"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BusFeed } from "@/lib/etaspot";

const POLL_MS = 10_000;

export interface BusFeedState {
  feed: BusFeed | null;
  /** When the browser last received a response (ms). */
  receivedAt: number | null;
  error: string | null;
  refresh: () => void;
}

/** Polls /api/buses every 10 s while the tab is visible. */
export function useBusFeed(): BusFeedState {
  const [feed, setFeed] = useState<BusFeed | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/buses", { cache: "no-store" });
      if (!res.ok) throw new Error(`Bus feed responded ${res.status}`);
      setFeed((await res.json()) as BusFeed);
      setReceivedAt(Date.now());
      setError(null);
    } catch {
      setError("Can't reach the bus feed. Check your connection; Lupus will keep trying.");
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stopped) timer.current = setTimeout(tick, POLL_MS);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { feed, receivedAt, error, refresh: load };
}
