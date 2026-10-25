# Lupus · Steel & Steam campus transit

A mobile-first web app (PWA) that replaces Stony Brook's ETA Spot tracker. Pick a destination and get the
fastest walk or walk + bus + walk route using live bus data, LIRR connections, voice directions in several
languages, and a pressure gauge that tells you whether to stroll or run. Built for SBUHacks 2026.

## Quick start

```bash
npm install            # also copies the MapLibre worker into public/
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Everything core (map, live buses, routing, LIRR) works with no keys at all. Keys switch on the extras
listed below, and every feature has a fallback when its key or upstream is missing.

## Environment variables

| Name | Enables | Without it |
| --- | --- | --- |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Conductor voice (ElevenLabs multilingual TTS), whistle generation | Browser speech |
| `ELEVENLABS_MODEL` (optional) | TTS model, default `eleven_multilingual_v2` | |
| `GEMINI_API_KEY` | Ask bar, translated directions, SOLAR screenshot import | Place search, English, manual class entry |
| `GEMINI_MODEL` (optional) | Default `gemini-flash-latest` | |
| `DATABASE_URL` | Tiger Data: history fallback, reliability badges, `/stats`, replay mode | Schedule fallback, no badges |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps base map (Maps JavaScript API) | MapLibre + OpenFreeMap |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` (optional) | Your Cloud map style; default `DEMO_MAP_ID` | |

Keys live in `.env.local` locally and in Vercel project settings in production. Never commit them.
The Google Maps key is public by design (it runs in the browser), so restrict it to your domains
(HTTP referrers) and to the Maps JavaScript API in Cloud Console. If Google fails to load (bad key,
billing, quota), the app switches to the free MapLibre map automatically.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (Vitest), using real saved samples in `data/samples/` |
| `npm run typecheck` / `lint` | Type and lint checks |
| `npm run poller` | Record live bus data into Tiger Data (see below) |
| `npm run accuracy` | Print the ETA accuracy study (same as `/stats`) |
| `npm run build:walk` | Rebuild `data/walk-graph.json` from OpenStreetMap (Overpass) |
| `npm run build:lirr` | Rebuild `data/lirr-stony-brook.json` from MTA's LIRR GTFS |
| `npm run build:timing` | Rebuild `data/route-timing.json` from ETA Spot's per-stop schedule (best run early morning) |
| `npm run make:whistle` | Generate `public/sounds/whistle.mp3` with ElevenLabs sound effects (run once, commit it) |

Add `--refresh` to `build:walk` / `build:lirr` to re-download instead of using `data/cache/`.
**The LIRR schedule file covers MTA's current feed window** (see `validTo` in the JSON): re-run
`npm run build:lirr` when MTA publishes a new feed.

## Recording bus data (Tiger Data)

Vercel functions can't run long processes, so the recorder is a plain Node script you run on a laptop or
VM for the whole hackathon. **Start it first**: replay mode, reliability badges and `/stats` need history.

1. Create a Tiger Data service and put its connection string in `.env.local`:
   `DATABASE_URL=postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:5432/tsdb?sslmode=require`
2. Create the hypertables and continuous aggregates once:
   ```bash
   npm run poller -- --init
   ```
3. Leave it running (on macOS, `caffeinate -i npm run poller` keeps the laptop awake):
   ```bash
   npm run poller
   ```

What it records:

| Table | Written | Contents |
| --- | --- | --- |
| `vehicle_snapshots` | every 10 s | bus positions (deduplicated by GPS fix time) |
| `eta_predictions` | every 60 s | ETA Spot's prediction for every stop (one call per stop, gently paced) |
| `stop_arrivals` | on arrival | bus came within 30 m of a stop on its route |
| `segment_times` | on arrival | seconds since that bus's previous stop |
| `prediction_errors` | on arrival | ETA Spot's error 2–5, 5–10 and 10–20 min before arrival |

Continuous aggregates `segment_hourly` and `lateness_hourly` roll these up by route and hour; the router
uses them for ride times when ETA Spot can't pair a trip, and route cards show reliability notes.

Try it without a database: `npm run poller -- --dry-run --once`.

**Storage (free tier):** every table is compressed once its data is 6 hours old (TimescaleDB
compression, typically 90%+ smaller), and the per-stop prediction sweep is skipped while no buses are in
service. A full service day is roughly 30 MB before compression. If a free service ever hits its storage
limit it turns read-only: the app keeps working, new rows just stop being recorded.

## Demo tools

- **Replay mode** plays recorded buses (and their ETAs) from Tiger Data on a loop as if live, our safety
  net if buses barely run during judging. Open `/?replay=1` (or `/?replay=0` to turn off), or in Settings
  tap the version line five times to reveal the toggle.
- **`/stats`** compares ETA Spot's prediction error with ours on held-out arrivals and explains the method.

## How it works

- **Routing** (`lib/router.ts`): walk-only, or walk → wait → one bus → walk. Boards within 600 m walking of
  the origin, alights within 600 m of the destination. Ride times come from ETA Spot (same trip seen at
  both stops), then Tiger Data history, then the scheduled timetable. Arrive-by returns the latest
  departure that still makes it; every option has `leaveBy` and `slackMinutes` (drives the gauge).
- **Walking** (`lib/walk.ts`): Dijkstra over OSM footways plus hand-entered building shortcuts
  (`data/shortcuts.json`) that are skipped when closed (campus time zone) or, in accessible mode, when
  they have stairs.
- **LIRR** (`lib/lirr.ts`): static GTFS reduced to Stony Brook trips, merged with GTFS-realtime delays and
  cancellations; falls back to a labeled "schedule only" mode. Track numbers are not in MTA's open feed.
- **Gemini** never supplies coordinates or times: it chooses from ids we provide and the server resolves
  them from our own data (`lib/ask.ts`, `lib/scheduleOcr.ts`).
- **Caching**: API responses carry `Cache-Control` (`s-maxage` 10 s for buses, 30 s for LIRR, a year for
  voice clips), upstream calls are shared with `use cache`, and there is a per-IP rate limit.

## Mapping campus by hand (`/editor`)

Run `npm run dev` and open http://localhost:3000/editor (needs the Google Maps key; it uses satellite view).

- **Place**: tap the spot (its main entrance is best), name it, pick a category, add nicknames. Drag any
  existing label to fix its position.
- **Path**: tap along a walkway point by point (footpaths OSM missed, cut-throughs between lots). Ends
  that land within 30 m of the existing network (blue) are joined to it; tick "Has stairs" so accessible
  routing avoids it.
- **Shortcut**: tap a building's entrance, any turns inside, then the exit; set weekday / Saturday / Sunday
  hours (or closed) and whether it's step-free. Closed shortcuts are skipped automatically.
- **Save** writes `data/places.json`, `data/custom-paths.json` and `data/shortcuts.json`; restart or reload
  and routing uses them. Commit those files to share them. Saving is refused on deployed builds.

## Data you should check

- `data/shortcuts.json`: three entries marked `placeholder: true`. Replace entry/exit points and hours.
- `data/places.json`: seeded from OSM building centers; move any that route to the wrong side.

## Deploying to Vercel

Import the repo in Vercel, add the env vars above, and deploy. `postinstall` copies the MapLibre worker,
and the committed data files mean nothing heavy is parsed at runtime.

## Credits

Base map by Google Maps (fallback: OpenFreeMap tiles). Walking network and building data
© OpenStreetMap contributors (ODbL). Transit data from ETA Spot (Stony
Brook University) and MTA. Built with Next.js, MapLibre, ElevenLabs, Gemini and Tiger Data.
