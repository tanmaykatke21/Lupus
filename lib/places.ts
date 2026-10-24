import rawPlaces from "@/data/places.json";
import type { Network } from "./network";

export interface Place {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  lat: number;
  lng: number;
  source?: string;
}

// Written by `npm run build:places` (empty until that has been run).
export const PLACES: Place[] = rawPlaces as Place[];

export function placeById(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}

/** Campus places plus every bus stop, so people can also search "Kelly" or "Chapin" by stop name. */
export function searchablePlaces(network: Network | null): Place[] {
  const stops: Place[] = (network?.stops ?? []).map((s) => ({
    id: `stop-${s.id}`,
    name: s.name,
    aliases: s.shortName && s.shortName.toLowerCase() !== s.name.toLowerCase() ? [s.shortName] : [],
    category: "bus stop",
    lat: s.lat,
    lng: s.lng,
  }));
  return [...PLACES, ...stops];
}
