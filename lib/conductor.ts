// Spoken guidance: plain instructions, nothing else.
import type { RouteOption } from "./router";
import type { Step } from "./steps";

const mins = (m: number) => `${Math.max(1, Math.round(m))} minute${Math.round(m) === 1 ? "" : "s"}`;

export function conductorIntro(option: RouteOption, destination: string) {
  const how = option.kind === "walk" ? "on foot" : "by walk and bus";
  return `Your route to ${destination} takes about ${mins(option.totalMinutes)} ${how}.`;
}

export function conductorLine(step: Step) {
  return step.text;
}

export function busApproaching(routeName: string, minutesAway: number) {
  return `Your ${routeName} bus arrives in about ${mins(minutesAway)}. Head to the stop.`;
}
