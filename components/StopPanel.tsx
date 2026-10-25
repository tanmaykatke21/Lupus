"use client";

import { useEffect, useState } from "react";
import type { BusRoute, BusStop, StopEta } from "@/lib/types";

interface Props {
  stop: BusStop;
  routes: BusRoute[];
  onClose: () => void;
}

export default function StopPanel({ stop, routes, onClose }: Props) {
  const [etas, setEtas] = useState<StopEta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () =>
      fetch(`/api/etas?stop=${stop.id}`)
        .then(async r => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error);
          if (!stopped) { setEtas(body.etas); setError(null); }
        })
        .catch(err => !stopped && setError(err.message));
    load();
    const id = setInterval(load, 15_000);
    return () => { stopped = true; clearInterval(id); };
  }, [stop.id]);

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Bus stop</p>
          <h2 className="font-display text-lg font-bold">{stop.name}</h2>
        </div>
        <button onClick={onClose} className="h-11 rounded-full btn-glass px-4 text-sm font-medium">
          Close
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-danger">Couldn&apos;t load arrivals: {error}</p>}
      {!etas && !error && <p className="text-sm text-muted">Checking arrivals…</p>}
      {etas && etas.length === 0 && <p className="text-sm text-muted">No upcoming arrivals listed.</p>}

      <ul className="space-y-2">
        {etas?.map(e => {
          const route = routes.find(r => r.id === e.routeId);
          return (
            <li key={`${e.routeId}-${e.tripKey}`} className="flex min-h-11 items-center gap-3 card rounded-2xl px-3 py-2">
              <span className="h-3 w-3 rounded-full" style={{ background: route?.color ?? "var(--brass)" }} aria-hidden />
              <span className="flex-1">
                <span className="font-medium">{route?.name ?? `Route ${e.routeId}`}</span>
                <span className="block text-xs text-muted">
                  {e.busId ? `Bus ${e.busId} · live` : "Scheduled"} · {e.scheduled}
                </span>
              </span>
              <span className="text-right font-display text-lg font-bold tabular-nums">
                {e.minutes < 1 ? "Due" : e.minutes < 60 ? `${e.minutes} min` : e.scheduled}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
