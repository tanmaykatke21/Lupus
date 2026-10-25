// The Steel & Steam conductor: every line states the instruction first, flavor last and short.
import type { RouteOption } from "./router";
import type { Step } from "./steps";

const mins = (m: number) => `${Math.max(1, Math.round(m))} minute${Math.round(m) === 1 ? "" : "s"}`;

export function conductorIntro(option: RouteOption, destination: string) {
  const how = option.kind === "walk" ? "on foot" : "by walk and bus";
  return `Your route to ${destination} takes about ${mins(option.totalMinutes)} ${how}. All aboard!`;
}

export function conductorLine(step: Step) {
  switch (step.icon) {
    case "bus":
      return step.text.startsWith("Board") ? `${step.text} Step lively, it's free to ride!` : step.text;
    case "arrive":
      return `${step.text} End of the line, safe travels.`;
    case "shortcut":
      return `${step.text} A conductor's secret.`;
    default:
      return step.text;
  }
}

export function busApproaching(routeName: string, minutesAway: number) {
  return `Your ${routeName} bus arrives in about ${mins(minutesAway)}. Full steam to the stop!`;
}
