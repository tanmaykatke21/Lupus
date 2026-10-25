// Plain-English step instructions for a route option. Short and clear first;
// the conductor flavor is added separately so it never hides the instruction.
import type { Leg, RouteOption } from "./router";
import { formatClock } from "./time";
import type { LngLat } from "./types";

export interface Step {
  icon: "walk" | "wait" | "bus" | "arrive" | "shortcut";
  text: string;
  detail?: string;
  end?: LngLat; // walk steps: where this step finishes (auto-advance by location)
  until?: number; // bus steps: when this step is over (auto-advance by clock)
  routeName?: string;
}

const mins = (s: number) => Math.max(1, Math.round(s / 60));

export function stepsFor(option: RouteOption, destination: string): Step[] {
  const out: Step[] = [];
  option.legs.forEach((leg: Leg, i) => {
    if (leg.type === "walk") {
      if (leg.seconds < 30) return;
      const target = i === option.legs.length - 1 ? destination : `the ${leg.toLabel} stop`;
      out.push({
        icon: "walk",
        text: `Walk ${mins(leg.seconds)} min to ${target}.`,
        detail: `${Math.round(leg.meters)} m${leg.stairs ? " · has stairs" : ""}`,
        end: leg.coords[leg.coords.length - 1],
      });
      for (const sc of leg.shortcuts) {
        out.push({ icon: "shortcut", text: `Cut through ${sc.name.replace(/^Through /, "")}.`, detail: sc.note });
      }
    } else if (leg.type === "wait") {
      if (leg.seconds >= 60) out.push({ icon: "wait", text: `Wait about ${mins(leg.seconds)} min at ${leg.stopName}.` });
    } else {
      out.push({
        icon: "bus",
        text: `Board the ${leg.routeName} at ${leg.boardStopName}, ${formatClock(leg.departAt)}.`,
        detail: leg.busId ? `Bus ${leg.busId} · tracked live` : "Scheduled time",
        until: leg.departAt,
        routeName: leg.routeName,
      });
      out.push({
        icon: "bus",
        text: `Ride ${leg.stopCount} stop${leg.stopCount === 1 ? "" : "s"} and get off at ${leg.alightStopName}.`,
        detail: `${mins((leg.arriveAt - leg.departAt) / 1000)} min ride`,
        until: leg.arriveAt,
        routeName: leg.routeName,
      });
    }
  });
  out.push({ icon: "arrive", text: `Arrive at ${destination} around ${formatClock(option.arriveAt)}.` });
  return out;
}
