// Records each demo segment as a webm + a keep-ranges JSON (to cut dead waiting time).
import { chromium, devices } from "playwright";
import fs from "node:fs";
const OUT = process.argv[2]; const only = process.argv[3];
const BASE = "http://localhost:3000";
const WEST = { latitude: 40.91228, longitude: -73.13261 };
const W = 390, H = 844;

const touchFx = `
(() => {
  const css = 'nextjs-portal{display:none!important} .tapfx{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(0,122,255,.35);border:2px solid rgba(0,122,255,.8);pointer-events:none;z-index:999999;animation:tapfx .6s ease-out forwards}@keyframes tapfx{from{transform:scale(.4);opacity:1}to{transform:scale(1.3);opacity:0}}';
  const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  addEventListener('pointerdown', e => { const d = document.createElement('div'); d.className = 'tapfx'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); }, true);
})();`;

async function segment(name, seed, fn) {
  if (only && only !== name) return;
  const dir = `${OUT}/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ channel: "chrome" });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: devices["iPhone 13"].userAgent, geolocation: WEST, permissions: ["geolocation"] });
  await ctx.addInitScript(touchFx);
  await ctx.addInitScript(() => { try { DeviceOrientationEvent.requestPermission = async () => "granted"; } catch {} let t = 0; setInterval(() => { t += 0.1; const heading = 75 + 25 * Math.sin(t / 2); for (const type of ["deviceorientationabsolute", "deviceorientation"]) window.dispatchEvent(new DeviceOrientationEvent(type, { alpha: (360 - heading) % 360, beta: 0, gamma: 0, absolute: true })); }, 100); });
  await ctx.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = q => q.includes("pointer: coarse") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); });
  await ctx.addInitScript(s => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem("lupus." + k, JSON.stringify(v)); } }, seed);
  const page = await ctx.newPage();

  let on = false, done = false, n = 0, clock = 0, last = null;
  const frames = [];
  const grab = (async () => {
    while (!done) {
      if (!on) { last = null; await new Promise(r => setTimeout(r, 30)); continue; }
      try {
        const r = await page.screenshot({ type: "jpeg", quality: 88 });
        const now = Date.now();
        if (last !== null && frames.length) { frames[frames.length - 1].d = (now - last) / 1000; clock += frames[frames.length - 1].d; }
        last = now; const f = `${String(n++).padStart(5, "0")}.jpg`;
        fs.writeFileSync(`${dir}/${f}`, r); frames.push({ f, d: 0.04 });
      } catch { await new Promise(r => setTimeout(r, 30)); }
    }
  })();
  const mark = { on: () => { on = true; }, off: () => { on = false; } };
  const wait = ms => page.waitForTimeout(ms);
  try { await fn(page, mark, wait); } catch (e) { console.error(name, e.message.split("\n")[0]); await page.screenshot({ path: `${OUT}/fail-${name}.png` }); }
  on = false; done = true; await grab;
  fs.writeFileSync(`${dir}/list.txt`, frames.map(x => `file '${x.f}'\nduration ${x.d.toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1)?.f}'\n`);
  await b.close();
  console.log("recorded", name, frames.length, "frames,", clock.toFixed(1), "s");
}

const ny = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })); return d; };
const hhmm = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][ny().getDay()];
const dayLabel = { sun: "Su", mon: "M", tue: "Tu", wed: "W", thu: "Th", fri: "F", sat: "Sa" }[dayKey];

// 1 · problem: compass home → map with live (replayed) buses
await segment("01-problem", { replay: true }, async (p, m, w) => {
  await p.goto(BASE); await p.getByText("Your schedule drives Lupus").waitFor(); await w(1500);
  m.on(); await w(3500);
  await p.getByRole("button", { name: "Open map" }).click(); await w(9000);
  await p.mouse.move(195, 300); // keep the map alive while buses move
  await w(10000);
});

// 3 · schedule-first compass
await segment("03-schedule-compass", { replay: true }, async (p, m, w) => {
  await p.goto(BASE); await p.getByText("Your schedule drives Lupus").waitFor(); await w(1500);
  m.on(); await w(1500);
  await p.getByRole("button", { name: "Add my schedule" }).click(); await w(2000);
  await p.getByRole("button", { name: "+ Add" }).click(); await w(1000);
  await p.getByPlaceholder("CSE 214").pressSequentially("BIO 202", { delay: 120 }); await w(400);
  const start = new Date(ny().getTime() + 30 * 60_000); start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5);
  await p.locator('input[type="time"]').first().fill(hhmm(start)); await w(500);
  await p.getByRole("group", { name: "Days" }).getByRole("button", { name: dayLabel, exact: true }).click(); await w(600);
  await p.locator("select").first().selectOption("life-sci"); await w(1000);
  await p.getByRole("button", { name: /^Save/ }).click(); await w(2500);
  await p.getByRole("button", { name: "Compass" }).click(); await w(1500);
  m.off(); await p.getByText(/Leave by|Leave now/).waitFor({ timeout: 40000 }); m.on();
  await w(7000);
  await p.getByRole("button", { name: "Guide me" }).click(); await w(9000);
});

// 4 · live routing on the map, then crowding reroute
await segment("04-live-routing", { replay: true, mode: "map" }, async (p, m, w) => {
  await p.goto(BASE); await p.getByText("Where to?").first().waitFor(); await w(2500);
  m.on(); await w(1500);
  await p.getByText("Where to?").first().click(); await w(1000);
  await p.getByPlaceholder("Where to?").pressSequentially("Hospital", { delay: 130 }); await w(1200);
  await p.getByRole("button", { name: /University Hospital/ }).first().click();
  m.off(); await p.getByText(/arrive \d/).first().waitFor({ timeout: 40000 }); m.on();
  await w(5000);
  const tabs = p.getByRole("tablist", { name: "Show" });
  await tabs.getByRole("tab", { name: "Bus" }).click(); await w(3000);
  await tabs.getByRole("tab", { name: "Walk" }).click(); await w(2500);
  await tabs.getByRole("tab", { name: "Best" }).click(); await w(2000);
  await p.getByRole("button", { name: "Settings" }).click(); await w(1500);
  const ver = p.getByRole("button", { name: /Lupus 0.1/ });
  for (let i = 0; i < 5; i++) { await ver.click(); await w(150); }
  await w(1000);
  await p.getByRole("switch").last().check(); await w(1500);
  await p.getByRole("button", { name: "Done" }).click();
  m.off(); await p.getByText(/is full/).first().waitFor({ timeout: 40000 }).catch(() => {}); m.on();
  await w(2500);
  await p.getByText(/is full/).first().scrollIntoViewIfNeeded().catch(() => {}); await w(6000);
});

// 5 · Ask Lupus
await segment("05-ask-lupus", { replay: true }, async (p, m, w) => {
  await p.goto(BASE); await p.getByText("Your schedule drives Lupus").waitFor(); await w(1500);
  m.on(); await w(1500);
  const t = new Date(ny().getTime() + 25 * 60_000); t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5);
  const h = t.getHours() % 12 || 12, mm = String(t.getMinutes()).padStart(2, "0"), ap = t.getHours() < 12 ? "AM" : "PM";
  await p.locator("#ask-lupus").click();
  await p.locator("#ask-lupus").pressSequentially(`I'm at West Apartments, lab in Life Sciences at ${h}:${mm} ${ap}. Will I make it?`, { delay: 45 });
  await w(800);
  await p.getByRole("button", { name: "Ask", exact: true }).click(); await w(2500);
  m.off(); await p.getByRole("button", { name: "Show on map" }).waitFor({ timeout: 90000 }); m.on();
  await p.getByRole("button", { name: "Show on map" }).scrollIntoViewIfNeeded(); await w(9000);
  await p.getByRole("button", { name: "Guide me" }).last().click(); await w(6000);
});
