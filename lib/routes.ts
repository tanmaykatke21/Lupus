// Route names come from ETA Spot's get_routes service. Until we save that file, buses show their route number.
// Colors are assigned by route id so each route keeps the same color everywhere in the app.
const PALETTE = ["#E8264F", "#2F6FDB", "#0E8F67", "#C77A00", "#7A4CD9", "#0A86A3", "#B3437F", "#4F5D75"];

export function routeColor(routeId: number): string {
  return PALETTE[Math.abs(routeId) % PALETTE.length];
}

export function routeName(routeId: number): string {
  return `Route ${routeId}`;
}
