"use client";

import { useEffect, useState } from "react";
import type { BusFeed } from "@/lib/etaspot";

interface Props {
  feed: BusFeed | null;
  receivedAt: number | null;
  error: string | null;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

export default function StatusPill({ feed, receivedAt, error }: Props) {
  // The clock starts after mount: reading time during prerender would bake a stale value into the page.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tickNow = () => setNow(Date.now());
    const first = setTimeout(tickNow, 0);
    const t = setInterval(tickNow, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  let dot = "bg-fur";
  let text = "Connecting to buses";
  if (error) {
    dot = "bg-fur";
    text = "Offline, retrying";
  } else if (feed?.source === "sample") {
    dot = "bg-fur";
    text = "Sample data";
  } else if (feed && receivedAt) {
    dot = "bg-red live-dot";
    text = `Live, updated ${ago((now ?? receivedAt) - receivedAt)}`;
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-sm font-medium shadow-[0_1px_4px_rgb(38_40_64/0.2)]"
    >
      <span className={`size-2.5 rounded-full ${dot}`} aria-hidden="true" />
      <span className="tabular">{text}</span>
    </div>
  );
}
