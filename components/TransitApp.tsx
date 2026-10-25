"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { useBusFeed } from "@/hooks/useBusFeed";
import { useLocation } from "@/hooks/useLocation";
import { useNavigation } from "@/hooks/useNavigation";
import { useNetwork } from "@/hooks/useNetwork";
import { useWalkPaths, type WalkLeg } from "@/hooks/useWalkPaths";
import { meters, type LatLng } from "@/lib/geo";
import { relevantRouteIds } from "@/lib/relevance";
import { routeColor, routeLabel, routeName, textOn } from "@/lib/routes";
import { searchablePlaces, type Place } from "@/lib/places";
import type { TravelMode, TripView } from "@/lib/planner";
import type { AnswerCard } from "@/lib/agent/run";
import type { NavPlan } from "@/lib/navEngine";
import AskLupus, { VERDICT, type AskState } from "./AskLupus";
import BusRow from "./BusRow";
import LiveMap from "./LiveMap";
import NavPanel from "./NavPanel";
import PlaceSearch from "./PlaceSearch";
import StatusPill from "./StatusPill";
import TripPanel from "./TripPanel";

/** Beyond this distance from every stop, GPS can't be the starting point (you're not on campus). */
const ON_CAMPUS_M = 1500;

const MODES: { id: TravelMode; label: string }[] = [
  { id: "best", label: "Best" },
  { id: "bus", label: "Bus" },
  { id: "walk", label: "Walk" },
];

export default function TransitApp() {
  const { feed, receivedAt, error } = useBusFeed();
  const network = useNetwork();
  const places = useMemo(() => searchablePlaces(network), [network]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [startPlace, setStartPlace] = useState<Place | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [shown, setShown] = useState<TripView | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>("best");
  // Live navigation: the trip being navigated, and whether it's the automatic demo walk.
  const [navPlan, setNavPlan] = useState<NavPlan | null>(null);
  const [navDemo, setNavDemo] = useState(false);
  const navigation = useNavigation(navPlan, navDemo);
  const [searching, setSearching] = useState(false);
  // The start-point box only makes the sheet taller; it must not hide the trip section it lives in.
  const [startSearching, setStartSearching] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  // The last Ask Lupus exchange, kept here so it survives closing the panel.
  const [askState, setAskState] = useState<AskState | null>(null);
  // Gemini's answer for the trip being shown, kept above the live trip after "Show on map".
  const [agentNote, setAgentNote] = useState<{
    toPlaceId: string;
    verdict: keyof typeof VERDICT;
    message: string;
    deadline: { label: string; atMs: number } | null;
  } | null>(null);
  const buses = useMemo(() => feed?.buses ?? [], [feed]);

  // Location is only requested once it's needed: for a trip, or when asking Lupus.
  const location = useLocation(Boolean(destination || askOpen) && !startPlace);
  const gpsOrigin = location.status === "found" ? location.position : null;
  const nearestStopM = useMemo(() => {
    if (!gpsOrigin || !network?.stops.length) return null;
    return Math.min(...network.stops.map((s) => meters(gpsOrigin, s)));
  }, [gpsOrigin, network]);
  const gpsOnCampus = nearestStopM !== null && nearestStopM <= ON_CAMPUS_M;

  const origin: LatLng | null = startPlace ?? (gpsOnCampus ? gpsOrigin : null);
  // While planning a trip, only routes that can take you there are drawn on the map.
  const focusRouteIds = useMemo(
    () => (destination && network ? relevantRouteIds(network, destination, origin) : null),
    [destination, network, origin],
  );

  // Walking directions along campus paths: the whole walk, plus the walks to and from the bus being shown.
  const busOption = shown?.kind === "bus" ? shown.option : null;
  const walkLegs = useMemo<WalkLeg[]>(() => {
    // While navigating, the navigation has its own route; don't re-plan the walk on every GPS update.
    if (!destination || !origin || navPlan) return [];
    const legs: WalkLeg[] = [{ from: origin, to: destination }];
    if (busOption) legs.push({ from: origin, to: busOption.board.stop }, { from: busOption.alight.stop, to: destination });
    return legs;
  }, [destination, origin, busOption, navPlan]);
  const walks = useWalkPaths(walkLegs);
  const directWalk = walks[0] ?? null;
  const walkLines = useMemo(() => {
    const lines = shown?.kind === "walk" ? [walks[0]] : busOption ? [walks[1], walks[2]] : [];
    return lines.filter((w) => w !== null && w !== undefined).map((w) => w.coords);
  }, [walks, shown, busOption]);

  const startNav = (demo: boolean) => {
    if (!destination || !origin) return;
    const o = busOption;
    setNavDemo(demo);
    setCollapsed(false);
    setNavPlan({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng, name: destination.name },
      bus:
        shown?.kind === "bus" && o
          ? {
              board: { lat: o.board.stop.lat, lng: o.board.stop.lng, name: o.board.stop.name },
              alight: { lat: o.alight.stop.lat, lng: o.alight.stop.lng, name: o.alight.stop.name },
              boardStopId: o.board.stop.id,
              alightStopId: o.alight.stop.id,
              routeId: o.routeId,
              busId: o.busId,
            }
          : null,
    });
  };
  const navigating = navPlan !== null;
  const clockShiftMs = feed?.source === "sample" && receivedAt ? feed.asOf - receivedAt : 0;

  const needStart =
    Boolean(destination) &&
    !startPlace &&
    (pickingStart || location.status === "denied" || location.status === "unavailable" || (gpsOrigin !== null && !gpsOnCampus));

  const toggleSelect = (id: string) => setSelectedId((cur) => (cur === id ? null : id));
  const onSearchOpen = useCallback((open: boolean) => {
    setSearching(open);
    if (open) setCollapsed(false);
  }, []);
  const onStartSearchOpen = useCallback((open: boolean) => {
    setStartSearching(open);
    if (open) setCollapsed(false);
  }, []);
  const chooseDestination = (p: Place | null) => {
    setDestination(p);
    setNavPlan(null);
    setAgentNote(null); // a destination picked by hand isn't the trip Lupus answered about
    if (!p) setShown(null);
  };

  // What the agent knows about where the rider is: a start they picked, or GPS when it's on campus.
  const agentCurrent = startPlace
    ? { lat: startPlace.lat, lng: startPlace.lng, label: startPlace.name }
    : gpsOnCampus && gpsOrigin
      ? { ...gpsOrigin, label: "Your location" }
      : null;
  const showAgentTrip = (card: AnswerCard) => {
    const to = places.find((p) => p.id === card.toPlaceId) ?? null;
    const from = card.fromPlaceId ? (places.find((p) => p.id === card.fromPlaceId) ?? null) : null;
    setDestination(to);
    setStartPlace(from);
    setPickingStart(false);
    setAskOpen(false);
    const answer = askState?.answer;
    // The deadline as an absolute time, so the live trip card can keep counting the buffer.
    const deadlineInMin = card.bufferMin !== null ? card.bufferMin + card.arriveInMin : null;
    setAgentNote({
      toPlaceId: card.toPlaceId,
      verdict: answer?.verdict ?? "info",
      message: answer?.message ?? "",
      deadline: card.deadline && deadlineInMin !== null ? { label: card.deadline, atMs: Date.now() + deadlineInMin * 60_000 } : null,
    });
  };
  const note = agentNote && destination?.id === agentNote.toPlaceId ? agentNote : null;
  const noteBadge = note ? VERDICT[note.verdict] : null;

  let heading = "Finding buses";
  if (feed) heading = buses.length === 1 ? "1 bus running" : `${buses.length} buses running`;

  let startNote = "";
  if (location.status === "denied") startNote = "Location is off for this site. Choose where you're starting.";
  else if (location.status === "unavailable") startNote = "Your location isn't available. Choose where you're starting.";
  else if (gpsOrigin && !gpsOnCampus && nearestStopM !== null)
    startNote = `You're ${(nearestStopM / 1000).toFixed(nearestStopM < 10_000 ? 1 : 0)} km from the nearest stop. Choose where you're starting.`;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <LiveMap
        buses={buses}
        network={network}
        selectedId={selectedId}
        onSelect={toggleSelect}
        destination={destination}
        origin={destination && !navigating ? origin : null}
        view={destination ? shown : null}
        walkLines={destination && !navigating ? walkLines : []}
        nav={navigating ? navigation.snapshot : null}
        navId={navPlan ? `${navPlan.destination.name}|${navDemo}|${navPlan.bus?.busId ?? "walk"}` : null}
        focusRouteIds={focusRouteIds}
      />

      {/* Top bar floats over the map */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] md:left-[25rem] md:right-14">
        <div className="pointer-events-auto rounded-full bg-white/95 px-4 py-2 shadow-[0_1px_4px_rgb(38_40_64/0.2)] md:hidden">
          <Image src="/logo.png" alt="Lupus" width={76} height={30} priority />
        </div>
        <div className="pointer-events-auto ml-auto mr-12 md:mr-0">
          <StatusPill feed={feed} receivedAt={receivedAt} error={error} />
        </div>
      </header>

      {/* Trip planner and bus list: bottom sheet on phones, left panel on wider screens */}
      <section
        aria-label="Trip planner"
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl bg-concrete shadow-[0_-4px_16px_rgb(38_40_64/0.18)] transition-[max-height] duration-300 md:inset-y-4 md:left-4 md:right-auto md:max-h-none md:w-[23rem] md:rounded-3xl ${
          // While searching, the sheet fills most of the screen so the phone keyboard can't cover suggestions.
          collapsed
            ? "max-h-[9.5rem]"
            : navigating
              ? "max-h-[48dvh]"
              : searching || startSearching
              ? "max-md:h-[88dvh] max-md:max-h-[88dvh]"
              : destination || askOpen
                ? "max-h-[75dvh]"
                : "max-h-[55dvh]"
        }`}
      >
        <div className="px-4 pt-3 md:pt-5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show trip details" : "Hide trip details"}
            className="mx-auto mb-3 block h-5 w-16 md:hidden"
          >
            <span className="mx-auto block h-1.5 w-10 rounded-full bg-fur/50" />
          </button>
          <div className="mb-3 hidden px-1 md:block">
            <Image src="/logo.png" alt="Lupus" width={96} height={38} priority />
          </div>
          {!askOpen && !navigating && (
            <PlaceSearch places={places} value={destination} onChoose={chooseDestination} onOpenChange={onSearchOpen} />
          )}
          {!askOpen && !navigating && !searching && !destination && (
            <button
              type="button"
              onClick={() => {
                setAskOpen(true);
                setCollapsed(false);
              }}
              className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-navy px-4 py-3 text-left text-white"
            >
              <span className="lane h-2 w-8 shrink-0 rounded-full" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Ask Lupus</span>
                <span className="block truncate text-sm text-white/75">&quot;Lab in Life Sciences at 2. Will I make it?&quot;</span>
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          {askOpen && (
            <AskLupus
              saved={askState}
              onSaved={setAskState}
              network={network}
              current={agentCurrent}
              onClose={() => setAskOpen(false)}
              onShowTrip={showAgentTrip}
            />
          )}

          {navPlan && (
            <NavPanel
              plan={navPlan}
              snapshot={navigation.snapshot}
              demo={navDemo}
              network={network}
              buses={buses}
              receivedAt={receivedAt}
              clockShiftMs={clockShiftMs}
              onGotOff={navigation.gotOffBus}
              onEnd={() => setNavPlan(null)}
            />
          )}

          {!askOpen && !navigating && destination && !searching && (
            <>
              {/* What Lupus said about this trip, kept after "Show on map" */}
              {note && (
                <article className="rounded-2xl border-2 border-navy bg-white px-4 py-3" aria-label="Ask Lupus answer">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-fur-dark">Lupus says</span>
                    {noteBadge && (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${noteBadge.cls}`}>{noteBadge.label}</span>
                    )}
                  </div>
                  <p className="mt-1 font-medium leading-snug">{note.message}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAskOpen(true)}
                      className="rounded-full bg-concrete px-3 py-1.5 text-sm font-medium hover:bg-fur/20"
                    >
                      Back to answer
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgentNote(null)}
                      className="rounded-full px-3 py-1.5 text-sm font-medium text-fur-dark hover:bg-concrete"
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              )}
              {/* Where the trip starts */}
              {needStart ? (
                <div className="flex flex-col gap-1.5">
                  {startNote && <p className="px-1 text-sm text-fur-dark">{startNote}</p>}
                  <PlaceSearch
                    places={places}
                    value={null}
                    onChoose={(p) => {
                      setStartPlace(p);
                      setPickingStart(false);
                    }}
                    onOpenChange={onStartSearchOpen}
                    searchLabel="Starting from"
                    placeholder="Starting from? Try SAC or Kelly"
                  />
                  {pickingStart && location.status === "found" && gpsOnCampus && (
                    <button
                      type="button"
                      onClick={() => setPickingStart(false)}
                      className="self-start rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white"
                    >
                      Use my location instead
                    </button>
                  )}
                </div>
              ) : startPlace ? (
                <PlaceSearch
                  places={places}
                  value={startPlace}
                  onChoose={(p) => {
                    setStartPlace(p);
                    if (!p) setPickingStart(true);
                  }}
                  chosenLabel="Starting from"
                  variant="start"
                />
              ) : (
                <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-concrete" aria-hidden="true">
                    <span className="size-3 rounded-full border-2 border-white bg-navy shadow-[0_0_0_2px_var(--navy)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fur-dark">Starting from</p>
                    <p className="truncate font-semibold">
                      {location.status === "found" ? "Your location" : "Finding your location"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPickingStart(true)}
                    className="shrink-0 rounded-full px-3 py-2 text-sm font-medium hover:bg-concrete"
                  >
                    Change
                  </button>
                </div>
              )}

              {/* Filter: whatever is fastest, only buses, or only walking */}
              <div role="radiogroup" aria-label="Show trips by" className="grid grid-cols-3 gap-1 rounded-full bg-white p-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={travelMode === m.id}
                    onClick={() => setTravelMode(m.id)}
                    className={`rounded-full py-1.5 text-sm font-semibold ${
                      travelMode === m.id ? "bg-navy text-white" : "text-fur-dark hover:bg-concrete"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {focusRouteIds && network && shown?.kind !== "walk" && (
                <div className="px-1" aria-label="Routes shown on the map">
                  {focusRouteIds.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm text-fur-dark">On the map:</span>
                      {focusRouteIds.map((id) => {
                        const c = routeColor(id, network);
                        // The route being ridden is solid; the others are faded, as on the map.
                        const ridden = shown?.kind === "bus" && shown.option?.routeId === id;
                        const faded = shown?.kind === "bus" && shown.option !== null && !ridden;
                        return (
                          <span
                            key={id}
                            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${faded ? "opacity-45" : ""}`}
                            style={{ background: c, color: textOn(c) }}
                            title={routeName(id, network)}
                          >
                            {routeLabel(id, network)}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-fur-dark">No bus route stops near {destination.name}, so walking is the way.</p>
                  )}
                </div>
              )}

              {origin && network && receivedAt ? (
                <TripPanel
                  origin={origin}
                  destination={destination}
                  network={network}
                  buses={buses}
                  receivedAt={receivedAt}
                  mode={travelMode}
                  walk={directWalk}
                  onStart={startNav}
                  onShow={setShown}
                  deadline={note?.deadline ?? null}
                  clockShiftMs={clockShiftMs}
                />
              ) : (
                !needStart && (
                  <p className="rounded-2xl bg-white px-4 py-4 text-sm text-fur-dark">
                    {!network || !receivedAt ? "Loading routes and buses." : "Waiting for your location."}
                  </p>
                )
              )}
            </>
          )}

          {!askOpen && !destination && !searching && (
            <>
              <h2 className="px-1 pb-1 pt-2 text-xl font-semibold">{heading}</h2>
              {feed?.notice && <p className="rounded-xl bg-white px-3 py-2 text-sm text-fur-dark">{feed.notice}</p>}
              {error && <p className="rounded-xl bg-white px-3 py-2 text-sm text-red-deep">{error}</p>}
              <ul id="bus-list" className="flex flex-col gap-2">
                {buses.map((bus) => (
                  <BusRow
                    key={bus.id}
                    bus={bus}
                    network={network}
                    selected={bus.id === selectedId}
                    onSelect={toggleSelect}
                  />
                ))}
                {feed && buses.length === 0 && (
                  <li className="rounded-2xl bg-white px-4 py-5 text-sm text-fur-dark">
                    No buses are in service right now. Lupus checks again every 10 seconds.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
