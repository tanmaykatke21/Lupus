import placesFile from "@/data/places.json";
import type { LngLat } from "./types";

export type PlaceCategory = "academic" | "dorm" | "dining" | "medical" | "transit" | "athletics" | "services" | "parking" | "shopping" | "town";

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  aliases: string[];
  lng: number;
  lat: number;
  service?: string; // when the shuttle there runs, e.g. "Shopping shuttle, Sundays"
}

export const PLACES = placesFile.places as Place[];
export const placeById = (id: string) => PLACES.find(p => p.id === id);
export const lngLat = (p: { lng: number; lat: number }): LngLat => [p.lng, p.lat];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim();

// Exact alias > prefix > word prefix > substring. Ties keep file order.
export function scorePlaces(query: string, limit = 8): { place: Place; score: number }[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { place: Place; score: number }[] = [];
  for (const p of PLACES) {
    let best = 0;
    for (const name of [p.name, ...p.aliases].map(norm)) {
      let s = 0;
      if (name === q) s = 100;
      else if (name.startsWith(q)) s = 80;
      else if (name.split(/\s+/).some(w => w.startsWith(q))) s = 60;
      else if (name.includes(q)) s = 40;
      best = Math.max(best, s);
    }
    if (best) scored.push({ place: p, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchPlaces(query: string, limit = 8): Place[] {
  return scorePlaces(query, limit).map(x => x.place);
}
