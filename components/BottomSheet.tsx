"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type Snap = "peek" | "half" | "full";

const SNAP_VH: Record<Snap, number> = { peek: 0.22, half: 0.52, full: 0.9 };

interface Props {
  snap: Snap;
  onSnapChange: (s: Snap) => void;
  onHeightChange?: (px: number) => void;
  header?: ReactNode;
  children: ReactNode;
}

// Mobile: draggable sheet with three snap points. ≥768px: fixed side panel.
export default function BottomSheet({ snap, onSnapChange, onHeightChange, header, children }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [vh, setVh] = useState(800);
  const [desktop, setDesktop] = useState(false);
  const start = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    const update = () => {
      setVh(window.innerHeight);
      setDesktop(window.matchMedia("(min-width: 768px)").matches);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const height = drag ?? SNAP_VH[snap] * vh;

  useEffect(() => {
    onHeightChange?.(desktop ? 0 : SNAP_VH[snap] * vh);
  }, [snap, vh, desktop, onHeightChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { y: e.clientY, h: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const h = Math.min(vh * 0.95, Math.max(vh * 0.12, start.current.h + (start.current.y - e.clientY)));
    setDrag(h);
  };
  const onPointerUp = () => {
    if (!start.current) return;
    const moved = drag !== null && Math.abs(drag - start.current.h) > 6;
    start.current = null;
    if (!moved) {
      // A tap on the handle cycles the sheet.
      onSnapChange(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
    } else {
      const frac = (drag ?? 0) / vh;
      const nearest = (Object.keys(SNAP_VH) as Snap[]).reduce((a, b) =>
        Math.abs(SNAP_VH[a] - frac) < Math.abs(SNAP_VH[b] - frac) ? a : b);
      onSnapChange(nearest);
    }
    setDrag(null);
  };

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") onSnapChange(snap === "peek" ? "half" : "full");
    if (e.key === "ArrowDown") onSnapChange(snap === "full" ? "half" : "peek");
  }, [snap, onSnapChange]);

  if (desktop) {
    return (
      <aside className="plate absolute left-4 top-4 bottom-4 z-10 flex w-[400px] flex-col overflow-hidden rounded-2xl shadow-2xl">
        {header}
        <div className="flex-1 overflow-y-auto px-4 pb-6">{children}</div>
      </aside>
    );
  }

  return (
    <section
      aria-label="Trip planner"
      className="plate absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.25)]"
      style={{ height, transition: drag === null ? "height 260ms cubic-bezier(.2,.8,.2,1)" : "none",
        paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <button
        type="button"
        aria-label={`Resize panel (currently ${snap})`}
        className="flex h-8 w-full shrink-0 touch-none items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKey}
      >
        <span className="h-1.5 w-12 rounded-full bg-brass/60" />
      </button>
      {header}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
    </section>
  );
}
