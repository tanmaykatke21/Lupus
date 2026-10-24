export interface LatLng {
  lat: number;
  lng: number;
}

/** Straight-line distance in meters (haversine). */
export function meters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Campus paths wind around buildings, so real walking distance runs about 30% over the straight line.
export const PATH_DETOUR = 1.3;
/** Average walking pace, about 4.8 km/h. */
export const WALK_M_PER_MIN = 80;
/** A hurried jog to catch a bus. */
export const RUN_M_PER_MIN = 150;

export function walkMinutes(a: LatLng, b: LatLng): number {
  return (meters(a, b) * PATH_DETOUR) / WALK_M_PER_MIN;
}
