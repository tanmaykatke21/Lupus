# Lupus

Live Stony Brook buses, with the stop and time that get you there. A mobile-first web app (PWA) built on
ETA Spot's public tracking feed, for SBUHacks 2026.

## Run it

Needs Node 20 or newer.

```bash
npm install                 # also copies MapLibre's worker into public/
cp .env.example .env.local  # no keys are needed for the live bus map
npm run dev                 # http://localhost:3000
```

To try it on your phone, deploy to Vercel (phones only share location over HTTPS) or open your laptop's
LAN address in the phone's browser for everything except location.

## What works now

- **Live bus layer** (`/api/buses`): keeps only buses that are in service and reported within the last
  3 minutes, converts ETA Spot's next-stop time (minutes since midnight, campus time) into a countdown,
  and adds crowding from `load` / `capacity`. One upstream call is shared by all visitors for 10 s.
- If ETA Spot can't be reached, the API serves the last good data for a minute, then a saved sample,
  and the app says it's showing sample data.
- **Map + bus list**: route-colored markers with heading arrows; the list sorts by soonest next stop.
  Buses due in under 2 minutes are marked in red. If the map tiles can't load, buses still show on a
  plain background.
- **"Where to?" search**: type a building or nickname ("SAC", "jav", "javitz", "new cs") to pick a
  destination; it drops a pin on the map and remembers your last three destinations on this device.
  Places come from `data/place-catalog.json` (names and nicknames) plus OpenStreetMap coordinates.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (Vitest) against two real ETA Spot snapshots in `data/samples/` |
| `npm run typecheck` / `lint` | Type and lint checks |
| `npm run save:etaspot` | Save ETA Spot's routes, stops and a vehicle snapshot to `data/samples/` |
| `npm run build:places` | Look up campus buildings in OpenStreetMap and write `data/places.json` (add `--refresh` to re-download) |

## Environment variables

| Name | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Trip agent and schedule import (coming next). Keep it in `.env.local`, never commit it. |
| `ETASPOT_MODE` | `live` (default) or `sample` to always serve the saved snapshot. |

## Credits

Map tiles from [OpenFreeMap](https://openfreemap.org), map data © OpenStreetMap contributors.
Rubik font by the Rubik Project Authors, SIL Open Font License (`app/fonts/RUBIK-OFL.txt`).
