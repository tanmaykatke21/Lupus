import rawPlaces from "@/data/places.json";

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
