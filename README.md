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
  Bus stops are searchable by name too ("Kelly", "Chapin").
- **Trip planner and leave-in card**: after you pick a destination, Lupus starts from your location (or a
  place you pick when you're off campus or location is off), checks every running bus, and shows when to
  leave, with a relax / walk / run cue, the stop to board, ride time and arrival time. It compares against
  walking the whole way and says when walking is faster. ETA Spot predicts each bus's next five stops;
  anything further is estimated from hop times seen live and is marked "about".
- **Ask Lupus** (`/api/agent`): ask in plain words ("I'm at West Apartments, lab in Life Sciences at 2. Will I
  make it?"), typed or spoken. Gemini answers only by calling our tools (`find_place`, `plan_trip`,
  `bus_status`, `stop_departures`) and finishes with `show_answer`; the answer card's times, stops and the
  yes / tight / no verdict are computed by our planner, never by the model. "Show on map" opens the trip in
  the live planner. With `AGENT_MODE=mock` a labeled offline stand-in answers simple from/to/time questions
  without Gemini (for demos without quota, and tests).
- **Routes and stops** (`/api/network`) come live from ETA Spot (cached 15 minutes, since weekday and weekend
  routes differ), falling back to the copy saved by `npm run save:etaspot`. The map draws each route in its
  ETA Spot color; where routes share a road they run side by side in lanes. During a trip only the routes
  that serve it are drawn, faded, with the route you'd ride solid.
- **Best / Bus / Walk filter**: Best shows whatever is fastest (no bus layer at all when walking wins), Bus
  always shows the fastest bus, Walk only the walk.
- **Walking directions** (`/api/walk`): walks follow real campus paths, sidewalks and stairs from
  OpenStreetMap, routed with A* over the network in `data/walkways.json` (built by `npm run build:walkways`).
  The map draws the whole walk, or the walks to and from the bus, and the trip times use the real distance.
  Without that file the app falls back to a straight line and says so.
- **Live navigation**: "Start" on a trip follows your GPS (high accuracy, screen kept awake). Your dot is
  snapped onto the path you're walking, the walked part turns grey, and the panel shows the next turn
  ("Turn left in 60 m") with time, distance and arrival. Wander more than 30 m off the path for three fixes
  and Lupus finds a new way from where you are. Bus trips go walk to the stop → ride (live countdown for your
  bus, "I'm off the bus") → walk to the destination. "Demo walk" plays the trip without GPS, for demos.
  Phones only share location over HTTPS, so test navigation on the deployed site (or localhost on a laptop).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (Vitest) against real ETA Spot snapshots frozen in `data/samples/` (`*-1225`, `*-1235`, `*-1430*`) |
| `npm run typecheck` / `lint` | Type and lint checks |
| `npm run save:etaspot` | Save ETA Spot's routes, stops and a vehicle snapshot to `data/samples/` |
| `npm run build:places` | Look up campus buildings in OpenStreetMap and write `data/places.json` (add `--refresh` to re-download) |
| `npm run build:walkways` | Download campus footpaths, sidewalks and walkable streets from OpenStreetMap and write the walking network to `data/walkways.json` (add `--refresh` to re-download) |

## Environment variables

| Name | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Ask Lupus (and schedule import, coming next). Keep it in `.env` or `.env.local`, never commit it. |
| `GEMINI_MODEL` | Optional, default `gemini-3.8-flash`. |
| `AGENT_MODE` | Optional. `mock` answers Ask Lupus offline without Gemini (clearly labeled in the app). |
| `ETASPOT_MODE` | `live` (default) or `sample` to always serve the saved snapshot. |

## Credits

Map tiles from [OpenFreeMap](https://openfreemap.org), map data © OpenStreetMap contributors.
Rubik font by the Rubik Project Authors, SIL Open Font License (`app/fonts/RUBIK-OFL.txt`).
