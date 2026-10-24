"use client";

import { useEffect, useRef } from "react";
import { announce } from "./voice";
import type { RouteOption } from "./router";
import type { TripRequest } from "./trip";
import { formatClock } from "./time";

const WARN_MIN = 5;

// Speaks "leave in 5 minutes…" and "time to leave…" once each for the selected deadline trip.
export function useLeaveAlert(option: RouteOption | undefined, req: TripRequest | null, now: number, enabled: boolean, lang = "en") {
  const fired = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled || !option || !req?.arriveBy || !now) return;
    const left = option.leaveBy - now;
    const what = req.purpose ?? `to reach ${req.to.name} by ${formatClock(req.arriveBy)}`;
    const id = `${req.to.name}|${req.arriveBy}`;
    if (left <= WARN_MIN * 60_000 && left > 60_000 && !fired.current.has(`${id}|warn`)) {
      fired.current.add(`${id}|warn`);
      announce(`Leave in ${Math.round(left / 60_000)} minutes ${what}.`, { lang });
    } else if (left <= 60_000 && left > -120_000 && !fired.current.has(`${id}|go`)) {
      fired.current.add(`${id}|go`);
      announce(`Time to leave now ${what}.`, { lang });
    }
  }, [option, req, now, enabled, lang]);
}
