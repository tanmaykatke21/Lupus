# Lupus · Steel & Steam campus transit

A mobile-first web app that replaces Stony Brook's ETA Spot tracker. Pick a destination and get the
fastest walk or walk + bus + walk route using live bus data, with LIRR connections and voice
directions. Built for SBUHacks 2026.

## Quick start

```bash
npm install            # also copies the MapLibre worker into public/
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` / `lint` | Type and lint checks |
| `npm run poller` | Record live bus data into Tiger Data (see below) |

## Environment variables

| Name | Used by |
| --- | --- |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Voice directions and sound effects |
| `GEMINI_API_KEY` | Ask bar, translation, schedule screenshot import |
| `DATABASE_URL` | Tiger Data (TimescaleDB) for the poller, reliability stats and replay |

Keys live in `.env.local` locally and in Vercel project settings in production. Never commit them.

## Recording bus data (Tiger Data)

Vercel functions can't run long processes, so the recorder is a plain Node script you run on your
laptop or a VM for the whole hackathon. **Start it first**: replay mode and reliability stats need history.

1. Create a Tiger Data service and copy its connection string into `.env.local`:
   `DATABASE_URL=postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:5432/tsdb?sslmode=require`
2. Create the tables (hypertables) once:
   ```bash
   npm run poller -- --init
   ```
3. Leave it running:
   ```bash
   npm run poller
   ```
   Every 10 s it stores bus positions (`vehicle_snapshots`) and derives actual stop arrivals when a bus
   comes within 30 m of a stop on its route (`stop_arrivals`). Every 60 s it stores ETA Spot's
   predictions for every stop (`eta_predictions`), so predicted vs actual can be compared later.
   It prints totals each minute; Ctrl+C stops it cleanly.

Try it without a database: `npm run poller -- --dry-run --once`.

Tip: keep the laptop awake (`caffeinate -i npm run poller` on macOS).

## Data sources

- ETA Spot (`stonybrook.etaspot.net/service.php`): routes, stops, vehicles, per-stop ETAs.
  Real responses are saved in `data/samples/`. `get_stop_etas` accepts one stop per call.
- MTA LIRR static GTFS and GTFS-realtime (no key needed).

## Deploying to Vercel

Import the repo in Vercel, add the env vars above, and deploy. API responses carry `Cache-Control`
headers (`s-maxage`) so Vercel's CDN absorbs repeat traffic instead of hitting upstream APIs.
