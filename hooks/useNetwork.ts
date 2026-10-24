"use client";

import { useEffect, useState } from "react";
import type { Network } from "@/lib/network";

const REFRESH_MS = 15 * 60 * 1000;

/** Routes and stops from /api/network, refreshed every 15 minutes (weekday and weekend routes differ). */
export function useNetwork(): Network | null {
  const [network, setNetwork] = useState<Network | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/network");
        if (res.ok && !stopped) setNetwork((await res.json()) as Network);
      } catch {
        // Keep whatever we had; bus rows fall back to route numbers until this loads.
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  return network;
}
