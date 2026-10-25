// Line icons in one weight (SF Symbols style), drawn in currentColor so they follow the theme.
import type { ReactNode } from "react";
import type { PlaceCategory } from "@/lib/places";
import type { Step } from "@/lib/steps";

const PATHS = {
  compass: <><circle cx="12" cy="12" r="9.5" /><path d="M16 8l-2.2 5.8L8 16l2.2-5.8z" /></>,
  gear: <><path d="M12 2.8l1.6 2.1 2.6-.6.6 2.6 2.6.6-.6 2.6 2.1 1.6-2.1 1.6.6 2.6-2.6.6-.6 2.6-2.6-.6L12 21.2l-1.6-2.1-2.6.6-.6-2.6-2.6-.6.6-2.6L3 12l2.1-1.6-.6-2.6 2.6-.6.6-2.6 2.6.6z" /><circle cx="12" cy="12" r="3" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  repeat: <path d="M17 2.5l3.5 3.5L17 9.5M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5L3.5 18 7 14.5M20.5 12.5V14a4 4 0 0 1-4 4h-13" />,
  speaker: <><path d="M11 5L6.5 9H3.5v6h3l4.5 4z" /><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12" /></>,
  speakerOff: <><path d="M11 5L6.5 9H3.5v6h3l4.5 4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  walk: <><circle cx="13.5" cy="4.5" r="1.8" /><path d="M9 21l2.6-7.2L15 17v4M7.5 11.5l3-3.5h3.5l2.5 3.5 2.5 1" /></>,
  wait: <path d="M6.5 3h11M6.5 21h11M7.5 3v3.5L12 12l-4.5 5.5V21M16.5 3v3.5L12 12l4.5 5.5V21" />,
  bus: <><rect x="4.5" y="3" width="15" height="15" rx="3" /><path d="M4.5 11h15M9 6.5h6M7.5 18v2.5M16.5 18v2.5" /><circle cx="8.5" cy="14.5" r=".9" fill="currentColor" /><circle cx="15.5" cy="14.5" r=".9" fill="currentColor" /></>,
  train: <><rect x="5" y="3" width="14" height="14" rx="3.5" /><path d="M5 10h14M8.5 21l2-4M15.5 21l-2-4" /><circle cx="9" cy="13.5" r=".9" fill="currentColor" /><circle cx="15" cy="13.5" r=".9" fill="currentColor" /></>,
  flag: <path d="M5.5 21V3.5M5.5 4h12l-2.5 4 2.5 4h-12" />,
  door: <><path d="M6.5 21V4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5V21M3.5 21h17" /><circle cx="14.5" cy="12" r=".9" fill="currentColor" /></>,
  location: <path d="M3.5 11L20.5 3.5 13 20.5l-2-7.5z" />,
  star: <path d="M12 3.3l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.1 6-.8z" />,
  pin: <><path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  cap: <path d="M2.5 9L12 4.5 21.5 9 12 13.5zM6.5 11v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11M21.5 9v5.5" />,
  building: <path d="M3.5 20.5h17M4.5 9.5h15M12 3.5l8 4.5H4zM6.5 9.5v8M10 9.5v8M14 9.5v8M17.5 9.5v8M4.5 17.5h15" />,
  bed: <><path d="M3.5 19V6M3.5 15h17v4M20.5 15v-2.5a3 3 0 0 0-3-3h-7v5.5" /><circle cx="7" cy="11.5" r="1.6" /></>,
  dining: <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17.5 21V3c-2.5 1-3.5 4-3.5 7.5 0 1.5 1 2.5 2 2.5h1.5" />,
  medical: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></>,
  trophy: <path d="M8.5 20.5h7M12 16.5v4M7.5 4h9v5a4.5 4.5 0 0 1-9 0zM7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4" />,
  bell: <path d="M3.5 18.5h17M5.5 18.5a6.5 6.5 0 0 1 13 0M12 12V9.5M10 9.5h4" />,
  parking: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M9.5 17V7.5H13a2.75 2.75 0 0 1 0 5.5H9.5" /></>,
  bag: <path d="M5.5 8h13l-1 12.5h-11zM9 8V6.5a3 3 0 0 1 6 0V8" />,
  anchor: <><circle cx="12" cy="5" r="1.8" /><path d="M12 6.8V20.5M8.5 10h7M4.5 13a7.5 7.5 0 0 0 15 0" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export const STEP_ICON: Record<Step["icon"], IconName> = { walk: "walk", wait: "wait", bus: "bus", arrive: "flag", shortcut: "door" };

export const CATEGORY_ICON: Record<PlaceCategory, IconName> = {
  academic: "building", dorm: "bed", dining: "dining", medical: "medical", transit: "train", athletics: "trophy",
  services: "bell", parking: "parking", shopping: "bag", town: "anchor",
};

/** Decorative by default; pass a `label` when the icon is the only thing saying what something is. */
export default function Icon({ name, className = "h-5 w-5", label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  );
}
