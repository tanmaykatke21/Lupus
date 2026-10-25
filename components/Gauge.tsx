// Pressure gauge: how rushed the traveler is, from slack minutes.
export type Pressure = "relaxed" | "brisk" | "run" | "missed";

export function pressureFor(slack: number | null): Pressure {
  if (slack === null || slack >= 5) return "relaxed";
  if (slack >= 2) return "brisk";
  if (slack >= 0) return "run";
  return "missed";
}

export const PRESSURE_LABEL: Record<Pressure, string> = {
  relaxed: "Relaxed", brisk: "Walk fast", run: "Run!", missed: "Too late",
};

export default function Gauge({ slack, size = 64 }: { slack: number | null; size?: number }) {
  const p = pressureFor(slack);
  // Needle sweeps -120° (relaxed) to +120° (run); clamp slack to [0, 10] min.
  const s = slack === null ? 10 : Math.max(0, Math.min(10, slack));
  const angle = p === "missed" ? 130 : 120 - (s / 10) * 240;
  const arc = (from: number, to: number, color: string) => {
    const r = 24, cx = 32, cy = 34;
    const pt = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    const [x1, y1] = pt(from), [x2, y2] = pt(to);
    return <path d={`M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`} stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />;
  };
  return (
    <figure className="flex flex-col items-center" aria-label={`Pressure: ${PRESSURE_LABEL[p]}`}>
      <svg viewBox="0 0 64 56" width={size} height={size * 0.875} role="img" aria-hidden="true">
        <circle cx="32" cy="34" r="30" fill="url(#gauge-rim)" stroke="var(--line)" strokeWidth="1" />
        <circle cx="32" cy="34" r="26" fill="var(--bg)" />
        <circle cx="32" cy="34" r="26" fill="var(--surface)" />
        {arc(-120, -40, "var(--ok)")}
        {arc(-40, 40, "var(--warn)")}
        {arc(40, 120, "var(--danger)")}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "32px 34px", transition: "transform 600ms cubic-bezier(.3,1.6,.5,1)" }}>
          <path d="M32 34 L30.5 33 L32 12 L33.5 33 Z" fill="var(--ink)" />
        </g>
        <circle cx="32" cy="34" r="3.5" fill="var(--ink)" />
        <defs>
          <linearGradient id="gauge-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--rim-hi)" />
            <stop offset="1" stopColor="var(--rim-lo)" />
          </linearGradient>
        </defs>
      </svg>
      <figcaption className={`text-[11px] font-bold uppercase tracking-wider ${p === "relaxed" ? "text-ok" : p === "brisk" ? "text-warn" : "text-danger"}`}>
        {PRESSURE_LABEL[p]}
      </figcaption>
    </figure>
  );
}
