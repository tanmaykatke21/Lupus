import { chromium } from "playwright";
import fs from "node:fs";
const C = process.argv[2], OUT = process.argv[3];
const foot = "Recorded on the running app · replay mode (real recorded SBU Transit buses from Tiger Data)";
const panels = {
  "01-problem": { k: "The problem", h: "ETA Spot shows dots, not decisions", b: ["No answer to “when should I leave?”", "Walk or wait for the bus? Guesswork", "Buses fill up at class change", "LIRR lives in a separate app"] },
  "03-schedule-compass": { k: "MVP 1 · Schedule-first compass", h: "Your next class drives the trip", b: ["Add classes once, or import a SOLAR screenshot", "Leave-by countdown + pressure gauge", "Guide me: heading-up compass along the route", "Spoken directions in 7 languages"] },
  "04-live-routing": { k: "MVP 2 · Live walk + bus routing", h: "Fastest way, honestly compared", b: ["117 campus places, nicknames included", "Live ETA Spot buses + our campus walking graph", "Best / Bus / Walk: says so when walking wins", "Skips packed buses (≥110% of seats) and explains"] },
  "05-ask-lupus": { k: "MVP 3 · Ask Lupus", h: "Just ask, in plain English", b: ["Type or speak a question", "Gemini agent picks from 7 tools", "Verdict, buffer and leave-by time", "Every time and stop comes from our router"] },
};
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [n, d] of Object.entries(panels)) {
  await p.goto(`file://${C}/panel.html?d=${encodeURIComponent(JSON.stringify({ ...d, f: foot }))}`); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/panel-${n}.png` });
}
await p.goto(`file://${C}/bezel.html`); await p.screenshot({ path: `${OUT}/bezel.png`, omitBackground: true });

async function film(name, url, seconds, setup) {
  const dir = `${OUT}/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  await p.goto(url); await p.waitForTimeout(800); if (setup) await setup();
  const frames = []; let last = Date.now(); const t0 = last; let n = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const r = await p.screenshot({ type: "jpeg", quality: 90 }); const now = Date.now();
    if (frames.length) frames.at(-1).d = (now - last) / 1000; last = now;
    const f = `${String(n++).padStart(5, "0")}.jpg`; fs.writeFileSync(`${dir}/${f}`, r); frames.push({ f, d: 0.04 });
  }
  fs.writeFileSync(`${dir}/list.txt`, frames.map(x => `file '${x.f}'\nduration ${x.d.toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1).f}'\n`);
  console.log("filmed", name, frames.length);
}
// (who-benefits already filmed)
await film("06-architecture", `file://${C}/architecture.html`, 45, async () => {
  await p.addScriptTag({ path: `${C}/archtour.js` }); await p.waitForTimeout(300); await p.evaluate(() => window.startTour());
});
await b.close();
