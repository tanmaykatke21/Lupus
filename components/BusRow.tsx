import type { Bus } from "@/lib/etaspot";
import type { Network } from "@/lib/network";
import { routeColor, routeLabel, routeName, stopName, textOn } from "@/lib/routes";

// The lane shows how soon the bus reaches its next stop: the dot travels toward the stop as time runs out.
const LANE_HORIZON_MIN = 15;

const CROWDING_LABEL: Record<Bus["crowding"], string> = {
  seats: "Seats available",
  busy: "Busy",
  full: "Nearly full",
  unknown: "Crowding unknown",
};

function countdown(min: number | null): { big: string; unit: string } {
  if (min === null) return { big: "–", unit: "" };
  if (min < 0.75) return { big: "Due", unit: "" };
  return { big: String(Math.round(min)), unit: "min" };
}

interface Props {
  bus: Bus;
  network: Network | null;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function BusRow({ bus, network, selected, onSelect }: Props) {
  const color = routeColor(bus.routeId, network);
  const next = stopName(bus.nextStopId, network);
  const { big, unit } = countdown(bus.minutesToNextStop);
  const soon = bus.minutesToNextStop !== null && bus.minutesToNextStop < 2;
  const progress =
    bus.minutesToNextStop === null ? 0 : 1 - Math.min(bus.minutesToNextStop, LANE_HORIZON_MIN) / LANE_HORIZON_MIN;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(bus.id)}
        aria-pressed={selected}
        className={`w-full rounded-2xl px-4 py-3 text-left transition-colors ${
          selected ? "bg-white shadow-[0_0_0_2px_var(--navy)]" : "bg-white/70 hover:bg-white"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className="grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-sm font-semibold"
            style={{ background: color, color: textOn(color) }}
          >
            {routeLabel(bus.routeId, network)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{routeName(bus.routeId, network)}</p>
            <p className="truncate text-sm text-fur-dark">
              {bus.atStop && next
                ? `At a stop now, next is ${next}`
                : next
                  ? `Next: ${next}${bus.nextStopAt ? ` at ${bus.nextStopAt}` : ""}`
                  : "Next stop not reported"}
            </p>
          </div>
          <p className={`tabular text-right leading-none ${soon ? "text-red" : "text-navy"}`}>
            <span className="text-3xl font-semibold">{big}</span>
            {unit && <span className="ml-1 text-sm font-medium">{unit}</span>}
          </p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="lane relative h-3 flex-1 rounded-full" aria-hidden="true">
            <span
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{ left: `${6 + progress * 88}%`, background: color }}
            />
            <span className="absolute right-1 top-1/2 size-2 -translate-y-1/2 rounded-full bg-lane" />
          </div>
          <span className="shrink-0 text-xs text-fur-dark">
            {CROWDING_LABEL[bus.crowding]}
            {bus.capacity > 0 && ` (${bus.load}/${bus.capacity})`}
          </span>
        </div>
      </button>
    </li>
  );
}
