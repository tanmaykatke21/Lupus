# Lupus · 2.5-minute demo script

Target length: **2:30** at a natural pace (~150 words/min, ~375 words).
Each section matches one demo clip in `docs/demo/` (filename in brackets).

---

## 1 · The problem (0:00 – 0:25) [`01-problem.mp4`]

**On screen:** Lupus opens on a phone; tap **Map**: live (replayed) buses moving along the Outer Loop and Hospital/Chapin lines.

> It's ten to two. Your lab in Life Sciences starts at two, and you're at West Apartments.
> Do you walk? Wait for the Outer Loop? Will the next bus even have room?
> Today, Stony Brook students answer that by juggling ETA Spot, Google Maps and guesswork.
> ETA Spot shows dots on a map. It never tells you when to leave.

## 2 · Who benefits (0:25 – 0:45) [`02-who-benefits.mp4`]

**On screen:** Title card with the numbers counting up.

> That question matters to a lot of people. Stony Brook has about twenty-six thousand seven hundred students,
> ten thousand living on campus and sixteen thousand commuting, plus around fifteen thousand faculty and hospital staff.
> That's roughly forty thousand people crossing a thousand-acre campus every day,
> and Lupus works for all of them, in any phone browser, with nothing to install.

## 3 · MVP feature 1: Schedule-first compass (0:45 – 1:08) [`03-schedule-compass.mp4`]

**On screen:** Add my schedule → + Add → BIO 202, today, Life Sciences → Save → compass home shows
**Next up**, the leave-by countdown and the pressure gauge → **Guide me** → route-following compass.

> Meet Lupus. Add your classes once, or import a screenshot from SOLAR,
> and Lupus picks your next class, finds the fastest way there, and counts down to the moment you need to leave.
> The pressure gauge tells you to stroll, walk briskly, or run.
> Tap Guide me, and your phone becomes a compass that points along your route, bus included,
> with spoken directions in seven languages.

## 4 · MVP feature 2: Live walk + bus routing, crowding-aware (1:08 – 1:33) [`04-live-routing.mp4`]

**On screen:** Map → Where to? → "Hospital" → route cards on the map → Best / Bus / Walk filter →
Settings → *Pretend the next bus is full* → the plan switches and explains why.

> Prefer a map? Search any of a hundred and seventeen campus places.
> Lupus combines live bus positions and stop predictions with our own campus walking network,
> building cut-throughs included, and compares walking against walk, bus, walk. If walking wins, it says so.
> And because the feed reports how full each bus is, Lupus skips a packed bus, reroutes you, and tells you why.

## 5 · MVP feature 3: Ask Lupus (1:33 – 1:53) [`05-ask-lupus.mp4`]

**On screen:** Type *"I'm at West Apartments, lab in Life Sciences at …. Will I make it?"* → verdict card.

> Or just ask. "I'm at West Apartments, lab in Life Sciences. Will I make it?"
> A Gemini agent calls our tools, like find place, plan trip, and train departures,
> and answers with a verdict and your leave-by time.
> Gemini only chooses the tools. Every time and stop comes from our own router, so it can't invent a bus.

## 6 · Architecture (1:53 – 2:30) [`06-architecture.mp4`]

**On screen:** Architecture diagram, panning layer by layer: client → CDN → API routes → domain core → external services and data.

> Under the hood, Lupus is a Next.js sixteen web app on Vercel.
> The phone handles GPS, compass heading and speech. API routes sit behind Vercel's CDN,
> which caches bus data for ten seconds and voice clips for a year.
> At the core, a router searches walk and bus options over a walking graph built from OpenStreetMap
> and our hand-mapped shortcuts.
> Live data comes from ETA Spot and the LIRR's realtime feed. Gemini powers the agent, translation and schedule import,
> and ElevenLabs gives the conductor a voice.
> A poller records every bus into Tiger Data, so we can fall back on history, measure ETA Spot's error,
> and replay real buses, like in this demo.
> Every service has a fallback. Lupus: know when to leave.

---

### Notes for the presenter

- Population figures are approximate: students from SBU's Fall 2024 fact book (26,689; 18,263 undergraduate),
  ~10,300 on-campus beds; the employee figure is the commonly cited one. Verify before quoting publicly.
- If buses aren't running during the live demo, open `/?replay=1` (recorded buses from Tiger Data).
- Demo tools in Settings appear after tapping the version line five times.
