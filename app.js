// Lupus prototype — campus A→B routing over walking + shuttle legs.

const WALK_MPS = 1.35;   // walking speed
const WALK_DETOUR = 1.3; // real paths are longer than straight lines
const BUS_MPS = 7;
const BUS_DETOUR = 1.4;
const DWELL_S = 20;
const MAX_BUS_OPTIONS = 3;

// ---------- i18n ----------

const I18N = {
  en: {
    from: "From", to: "To", go: "Go", leaveNow: "Leave now", leaveAt: "Leave at…", nextClass: "▶ Next class",
    routes: "Routes", speak: "🔊 Guide me", stop: "■ Stop", lirr: "LIRR at Stony Brook", nearby: "Nearby",
    save: "☆ Save", saved: "★ Saved", schedule: "My class schedule", add: "Add", shortcuts: "Student shortcuts",
    language: "Language", myLocation: "My location", walkOnly: "Walk", fastest: "Fastest", arrive: "Arrive {time}",
    walkTo: "Walk {min} min to {place}", cutThrough: "Cut through {name}", board: "Take {route} from {stop} at {time}",
    ride: "Ride {n} stops", alight: "Get off at {stop}", arrived: "Arrive at {place} around {time}",
    leaveBy: "Leave by {time} to make {cls} at {at}", noClass: "No upcoming classes. Add one below.",
    same: "Pick two different places.", unknown: "Couldn't find “{q}”.", westbound: "Westbound (to NYC)",
    eastbound: "Eastbound (Port Jeff)", make: "You'll make it", tight: "Too tight", menuMissing: "Today's menu appears here once Nutrislice is connected in config.js.",
    minWalk: "{min} min walk", openHours: "Open {open}–{close}", now: "Open now", closed: "Closed now", min: "min",
  },
  es: {
    from: "Desde", to: "Hasta", go: "Ir", leaveNow: "Salir ahora", leaveAt: "Salir a las…", nextClass: "▶ Próxima clase",
    routes: "Rutas", speak: "🔊 Guíame", stop: "■ Parar", lirr: "LIRR en Stony Brook", nearby: "Cerca",
    save: "☆ Guardar", saved: "★ Guardado", schedule: "Mi horario", add: "Añadir", shortcuts: "Atajos estudiantiles",
    language: "Idioma", myLocation: "Mi ubicación", walkOnly: "Caminar", fastest: "Más rápida", arrive: "Llega {time}",
    walkTo: "Camina {min} min hasta {place}", cutThrough: "Atraviesa {name}", board: "Toma {route} en {stop} a las {time}",
    ride: "Viaja {n} paradas", alight: "Bájate en {stop}", arrived: "Llegas a {place} hacia las {time}",
    leaveBy: "Sal antes de las {time} para llegar a {cls} a las {at}", noClass: "No hay clases próximas. Añade una abajo.",
    same: "Elige dos lugares distintos.", unknown: "No se encontró “{q}”.", westbound: "Hacia el oeste (NYC)",
    eastbound: "Hacia el este (Port Jeff)", make: "Llegas a tiempo", tight: "Muy justo", menuMissing: "El menú de hoy aparecerá aquí al conectar Nutrislice.",
    minWalk: "{min} min a pie", openHours: "Abierto {open}–{close}", now: "Abierto", closed: "Cerrado", min: "min",
  },
  zh: {
    from: "出发", to: "到达", go: "出发", leaveNow: "现在出发", leaveAt: "出发时间…", nextClass: "▶ 下一节课",
    routes: "路线", speak: "🔊 语音导航", stop: "■ 停止", lirr: "石溪 LIRR 火车", nearby: "附近",
    save: "☆ 收藏", saved: "★ 已收藏", schedule: "我的课表", add: "添加", shortcuts: "学生捷径",
    language: "语言", myLocation: "我的位置", walkOnly: "步行", fastest: "最快", arrive: "{time} 到达",
    walkTo: "步行 {min} 分钟到 {place}", cutThrough: "穿过 {name}", board: "{time} 在 {stop} 乘坐 {route}",
    ride: "乘坐 {n} 站", alight: "在 {stop} 下车", arrived: "约 {time} 到达 {place}",
    leaveBy: "请在 {time} 前出发，赶上 {at} 的 {cls}", noClass: "没有即将到来的课程，请在下方添加。",
    same: "请选择两个不同的地点。", unknown: "找不到“{q}”。", westbound: "西行（纽约）",
    eastbound: "东行（Port Jeff）", make: "赶得上", tight: "来不及", menuMissing: "连接 Nutrislice 后将显示今日菜单。",
    minWalk: "步行 {min} 分钟", openHours: "开放 {open}–{close}", now: "开放中", closed: "已关闭", min: "分钟",
  },
  hi: {
    from: "से", to: "तक", go: "चलें", leaveNow: "अभी निकलें", leaveAt: "निकलने का समय…", nextClass: "▶ अगली क्लास",
    routes: "रास्ते", speak: "🔊 आवाज़ गाइड", stop: "■ रोकें", lirr: "स्टोनी ब्रुक LIRR", nearby: "आस-पास",
    save: "☆ सेव", saved: "★ सेव किया", schedule: "मेरा क्लास शेड्यूल", add: "जोड़ें", shortcuts: "छात्र शॉर्टकट",
    language: "भाषा", myLocation: "मेरी लोकेशन", walkOnly: "पैदल", fastest: "सबसे तेज़", arrive: "{time} पहुँचें",
    walkTo: "{place} तक {min} मिनट पैदल चलें", cutThrough: "{name} से होकर जाएँ", board: "{time} पर {stop} से {route} लें",
    ride: "{n} स्टॉप तक जाएँ", alight: "{stop} पर उतरें", arrived: "लगभग {time} पर {place} पहुँचें",
    leaveBy: "{at} की {cls} के लिए {time} तक निकलें", noClass: "कोई आगामी क्लास नहीं। नीचे जोड़ें।",
    same: "दो अलग जगहें चुनें।", unknown: "“{q}” नहीं मिला।", westbound: "पश्चिम (NYC)",
    eastbound: "पूर्व (Port Jeff)", make: "पहुँच जाएँगे", tight: "समय कम है", menuMissing: "Nutrislice जोड़ने पर आज का मेन्यू यहाँ दिखेगा।",
    minWalk: "{min} मिनट पैदल", openHours: "खुला {open}–{close}", now: "अभी खुला", closed: "बंद", min: "मिनट",
  },
  ko: {
    from: "출발", to: "도착", go: "길찾기", leaveNow: "지금 출발", leaveAt: "출발 시간…", nextClass: "▶ 다음 수업",
    routes: "경로", speak: "🔊 음성 안내", stop: "■ 중지", lirr: "스토니브룩 LIRR", nearby: "주변",
    save: "☆ 저장", saved: "★ 저장됨", schedule: "내 수업 시간표", add: "추가", shortcuts: "학생 지름길",
    language: "언어", myLocation: "내 위치", walkOnly: "도보", fastest: "최단", arrive: "{time} 도착",
    walkTo: "{place}까지 {min}분 걷기", cutThrough: "{name} 통과", board: "{time}에 {stop}에서 {route} 탑승",
    ride: "{n}개 정류장 이동", alight: "{stop}에서 하차", arrived: "{time}쯤 {place} 도착",
    leaveBy: "{at} {cls}에 늦지 않으려면 {time}까지 출발", noClass: "예정된 수업이 없습니다. 아래에서 추가하세요.",
    same: "서로 다른 장소를 선택하세요.", unknown: "“{q}”을(를) 찾을 수 없습니다.", westbound: "서쪽 (NYC)",
    eastbound: "동쪽 (Port Jeff)", make: "탑승 가능", tight: "촉박함", menuMissing: "Nutrislice 연결 시 오늘의 메뉴가 표시됩니다.",
    minWalk: "도보 {min}분", openHours: "운영 {open}–{close}", now: "운영 중", closed: "운영 종료", min: "분",
  },
};
const SPEECH_LANG = { en: "en-US", es: "es-ES", zh: "zh-CN", hi: "hi-IN", ko: "ko-KR" };

function t(key, vars = {}) {
  const s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// ---------- storage, cache, rate limit ----------

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("lupus." + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("lupus." + key, JSON.stringify(value)); } catch {}
  },
};

let lang = store.get("lang", "en");

const responseCache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  responseCache.set(key, { at: Date.now(), value });
  return value;
}

// Token bucket shared by all outbound API calls.
const limiter = {
  max: 6, tokens: 6, refillMs: 10000, last: Date.now(),
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.max, this.tokens + (now - this.last) / this.refillMs);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  },
};

// ---------- geometry & graph ----------

const extraNodes = {}; // e.g. "me" for the user's location
const NODE_BY_ID = {};
[...PLACES, ...STOPS].forEach(n => (NODE_BY_ID[n.id] = n));
const node = id => extraNodes[id] || NODE_BY_ID[id];
const allNodes = () => [...PLACES, ...STOPS, ...Object.values(extraNodes)];

function meters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const SHORTCUT_ADJ = {};
SHORTCUTS.forEach(sc => {
  (SHORTCUT_ADJ[sc.from] ||= []).push({ to: sc.to, sc });
  (SHORTCUT_ADJ[sc.to] ||= []).push({ to: sc.from, sc });
});
const isOpen = (sc, tMin) => { const h = (tMin / 60) % 24; return h >= sc.open && h < sc.close; };

// Dijkstra over a complete walking graph plus open building shortcuts.
function walkTree(srcId, tMin) {
  const ns = allNodes();
  const dist = {}, prev = {}, via = {}, done = new Set();
  ns.forEach(n => (dist[n.id] = Infinity));
  dist[srcId] = 0;
  for (;;) {
    let u = null;
    for (const n of ns) if (!done.has(n.id) && (u === null || dist[n.id] < dist[u])) u = n.id;
    if (u === null || dist[u] === Infinity) break;
    done.add(u);
    for (const n of ns) {
      if (done.has(n.id)) continue;
      const w = meters(node(u), n) * WALK_DETOUR / WALK_MPS;
      if (dist[u] + w < dist[n.id]) { dist[n.id] = dist[u] + w; prev[n.id] = u; via[n.id] = null; }
    }
    for (const { to, sc } of SHORTCUT_ADJ[u] || []) {
      if (done.has(to) || !isOpen(sc, tMin)) continue;
      const w = meters(node(u), node(to)) / WALK_MPS;
      if (dist[u] + w < dist[to]) { dist[to] = dist[u] + w; prev[to] = u; via[to] = sc; }
    }
  }
  return { dist, prev, via };
}

// Path from tree source to `id`, as node ids plus shortcuts used.
function treePath(tree, id) {
  const ids = [id], shortcuts = [];
  while (tree.prev[ids[0]] !== undefined) {
    if (tree.via[ids[0]]) shortcuts.unshift(tree.via[ids[0]]);
    ids.unshift(tree.prev[ids[0]]);
  }
  return { ids, shortcuts };
}

function walkLeg(ids, shortcuts, sec) {
  return { type: "walk", ids, shortcuts, sec };
}

// Cumulative seconds from a route's first stop to each stop index.
const ROUTE_OFFSETS = {};
ROUTES.forEach(r => {
  const offs = [0];
  for (let i = 1; i < r.stops.length; i++) {
    const seg = meters(node(r.stops[i - 1]), node(r.stops[i])) * BUS_DETOUR / BUS_MPS;
    offs.push(offs[i - 1] + seg + DWELL_S);
  }
  ROUTE_OFFSETS[r.id] = offs;
});

// Next departure (minutes since midnight) of route r at stop index i, at or after tMin.
function nextDeparture(r, i, tMin) {
  const off = ROUTE_OFFSETS[r.id][i] / 60;
  const start = r.first * 60;
  const n = Math.max(0, Math.ceil((tMin - start - off) / r.headway));
  const tripStart = start + n * r.headway;
  return tripStart <= r.last * 60 ? tripStart + off : null;
}

function plan(fromId, toId, tMin) {
  const fromTree = walkTree(fromId, tMin);
  const toTree = walkTree(toId, tMin);
  const direct = treePath(fromTree, toId);
  const walkSec = fromTree.dist[toId];
  const options = [{
    kind: "walk",
    arrive: tMin + walkSec / 60,
    legs: [walkLeg(direct.ids, direct.shortcuts, walkSec)],
  }];

  const busOptions = [];
  for (const r of ROUTES) {
    let best = null;
    for (let i = 0; i < r.stops.length - 1; i++) {
      const board = r.stops[i];
      const atStop = tMin + fromTree.dist[board] / 60;
      const dep = nextDeparture(r, i, atStop);
      if (dep === null) continue;
      for (let j = i + 1; j < r.stops.length; j++) {
        const alight = r.stops[j];
        if (alight === board) break;
        const rideMin = (ROUTE_OFFSETS[r.id][j] - ROUTE_OFFSETS[r.id][i]) / 60;
        const arrive = dep + rideMin + toTree.dist[alight] / 60;
        if (!best || arrive < best.arrive) best = { r, i, j, dep, rideMin, arrive };
      }
    }
    if (!best || best.arrive >= options[0].arrive) continue;
    const { r: route, i, j, dep } = best;
    const p1 = treePath(fromTree, route.stops[i]);
    const p2 = treePath(toTree, route.stops[j]);
    busOptions.push({
      kind: "bus",
      arrive: best.arrive,
      legs: [
        walkLeg(p1.ids, p1.shortcuts, fromTree.dist[route.stops[i]]),
        { type: "bus", route, i, j, dep, sec: best.rideMin * 60 },
        walkLeg(p2.ids.slice().reverse(), p2.shortcuts.slice().reverse(), toTree.dist[route.stops[j]]),
      ],
    });
  }
  busOptions.sort((a, b) => a.arrive - b.arrive);
  return [...busOptions.slice(0, MAX_BUS_OPTIONS), ...options].sort((a, b) => a.arrive - b.arrive);
}

// ---------- formatting ----------

function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
function fmtTime(min) {
  const d = new Date(); d.setHours(0, Math.round(min), 0, 0);
  return d.toLocaleTimeString(SPEECH_LANG[lang], { hour: "numeric", minute: "2-digit" });
}
const mins = sec => Math.max(1, Math.round(sec / 60));
const hhmmToMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function optionSteps(opt, toId) {
  const steps = [];
  for (const leg of opt.legs) {
    if (leg.type === "walk") {
      if (leg.sec < 30) continue;
      steps.push(t("walkTo", { min: mins(leg.sec), place: node(leg.ids[leg.ids.length - 1]).name }));
      leg.shortcuts.forEach(sc => steps.push("↳ " + t("cutThrough", { name: sc.name }) + (sc.note ? ` — ${sc.note}` : "")));
    } else {
      const r = leg.route;
      steps.push(t("board", { route: r.name, stop: node(r.stops[leg.i]).name, time: fmtTime(leg.dep) }));
      steps.push(t("ride", { n: leg.j - leg.i }));
      steps.push(t("alight", { stop: node(r.stops[leg.j]).name }));
    }
  }
  steps.push(t("arrived", { place: node(toId).name, time: fmtTime(opt.arrive) }));
  return steps;
}

// ---------- map ----------

const map = L.map("map", { zoomControl: true }).setView([40.9135, -73.1235], 16);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
}).addTo(map);

const KIND_COLOR = { dorm: "#6b46c1", dining: "#dd6b20", lecture: "#2b6cb0", lab: "#2c7a7b", transit: "#2f855a", parking: "#718096", building: "#262840" };

ROUTES.forEach(r => {
  L.polyline(r.stops.map(id => [node(id).lat, node(id).lng]), { color: r.color, weight: 3, opacity: 0.18 }).addTo(map);
});
STOPS.forEach(s => {
  L.circleMarker([s.lat, s.lng], { radius: 4, color: "#262840", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip("🚌 " + s.name).addTo(map);
});
PLACES.forEach(p => {
  L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: KIND_COLOR[p.kind], fillOpacity: 1 })
    .bindPopup(`<b>${esc(p.name)}</b><br>
      <button class="chip" data-act="from" data-id="${p.id}">${esc(t("from"))}</button>
      <button class="chip" data-act="to" data-id="${p.id}">${esc(t("to"))}</button>`)
    .addTo(map);
});
map.on("popupopen", e => {
  e.popup.getElement().querySelectorAll("button[data-act]").forEach(b => b.addEventListener("click", () => {
    $(b.dataset.act === "from" ? "#from" : "#to").value = node(b.dataset.id).name;
    map.closePopup();
    if ($("#from").value && $("#to").value) go();
  }));
});

const routeLayer = L.layerGroup().addTo(map);
let meMarker = null;

function drawOption(opt) {
  routeLayer.clearLayers();
  const bounds = [];
  for (const leg of opt.legs) {
    let pts;
    if (leg.type === "walk") {
      pts = leg.ids.map(id => [node(id).lat, node(id).lng]);
      L.polyline(pts, { color: "#262840", weight: 4, dashArray: "2 8", lineCap: "round" }).addTo(routeLayer);
    } else {
      pts = leg.route.stops.slice(leg.i, leg.j + 1).map(id => [node(id).lat, node(id).lng]);
      L.polyline(pts, { color: leg.route.color, weight: 6, opacity: 0.9 }).addTo(routeLayer);
    }
    bounds.push(...pts);
  }
  const [a, b] = [bounds[0], bounds[bounds.length - 1]];
  L.circleMarker(a, { radius: 8, color: "#fff", weight: 3, fillColor: "#262840", fillOpacity: 1 }).addTo(routeLayer);
  L.circleMarker(b, { radius: 9, color: "#fff", weight: 3, fillColor: "#ed2350", fillOpacity: 1 }).addTo(routeLayer);
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
}

// ---------- UI ----------

const $ = s => document.querySelector(s);
let current = null; // { fromId, toId, options, selected, title }

function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => (el.textContent = t(el.dataset.i18n)));
  const list = $("#placeList");
  list.innerHTML = `<option value="${esc(t("myLocation"))}">` + PLACES.map(p => `<option value="${esc(p.name)}">`).join("");
  renderSaved();
  renderClasses();
  renderShortcuts();
  if (current) render();
}

function resolve(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;
  if (extraNodes.me && Object.values(I18N).some(d => d.myLocation.toLowerCase() === q)) return "me";
  const exact = [...PLACES, ...STOPS].find(n => n.name.toLowerCase() === q);
  if (exact) return exact.id;
  const partial = PLACES.find(n => n.name.toLowerCase().includes(q));
  return partial ? partial.id : null;
}

function departMin() {
  return $("#when").value === "at" && $("#whenTime").value ? hhmmToMin($("#whenTime").value) : nowMin();
}

function go(title) {
  const fromQ = $("#from").value, toQ = $("#to").value;
  const fromId = resolve(fromQ), toId = resolve(toQ);
  if (!fromId) return alertMsg(t("unknown", { q: fromQ }));
  if (!toId) return alertMsg(t("unknown", { q: toQ }));
  if (fromId === toId) return alertMsg(t("same"));
  stopSpeaking();
  const tMin = departMin();
  current = { fromId, toId, tMin, options: plan(fromId, toId, tMin), selected: 0, title: typeof title === "string" ? title : null };
  render();
  loadNearby(toId);
}

function alertMsg(msg) {
  $("#results").hidden = false;
  $("#options").innerHTML = `<li class="muted">${esc(msg)}</li>`;
  $("#detail").hidden = true;
}

function render() {
  const { options, selected, toId } = current;
  $("#results").hidden = false;
  $("#options").innerHTML = options.map((o, idx) => {
    const total = mins((o.arrive - current.tMin) * 60);
    const legs = o.legs.filter(l => l.type === "bus" || l.sec >= 30).map(l => l.type === "walk"
      ? `<span class="leg">🚶 ${mins(l.sec)}</span>`
      : `<span class="leg bus" style="background:${l.route.color}">🚌 ${esc(l.route.name)}</span>`).join("›");
    return `<li class="option ${idx === selected ? "active" : ""}" data-idx="${idx}">
      <div><div class="eta">${total} ${esc(t("min"))}</div>
      <div class="sub">${esc(t("arrive", { time: fmtTime(o.arrive) }))}${o.kind === "walk" ? " · " + esc(t("walkOnly")) : ""}</div></div>
      ${idx === 0 ? `<span class="badge">${esc(t("fastest"))}</span>` : "<span></span>"}
      <div class="legs">${legs}</div></li>`;
  }).join("");
  document.querySelectorAll(".option").forEach(el => el.addEventListener("click", () => {
    current.selected = +el.dataset.idx;
    stopSpeaking();
    render();
  }));

  const opt = options[selected];
  $("#detail").hidden = false;
  $("#detailTitle").textContent = current.title || node(toId).name;
  $("#steps").innerHTML = optionSteps(opt, toId).map(s => `<li>${esc(s)}</li>`).join("");
  drawOption(opt);
  renderTrains(opt);
  $("#saveDest").textContent = store.get("saved", []).includes(toId) ? t("saved") : t("save");
}

function renderTrains(opt) {
  const box = $("#trains");
  if (current.toId !== "lirr") { box.hidden = true; return; }
  box.hidden = false;
  const arrive = opt.arrive;
  const section = (label, list) => {
    const upcoming = list.map(hhmmToMin).filter(m => m >= current.tMin - 1).slice(0, 4);
    return `<p class="muted">${esc(label)}</p>` + upcoming.map(m => {
      const ok = arrive + 2 <= m; // 2 min to reach the platform
      return `<div class="train"><span>${fmtTime(m)}</span><span class="${ok ? "ok" : "miss"}">${esc(ok ? t("make") : t("tight"))}</span></div>`;
    }).join("");
  };
  $("#trainList").innerHTML = section(t("westbound"), LIRR_DEPARTURES.westbound) + section(t("eastbound"), LIRR_DEPARTURES.eastbound);
}

// ---------- nearby (Gemini) + menu (Nutrislice) ----------

async function loadNearby(toId) {
  const place = node(toId);
  if (!place || toId === "me") { $("#nearby").hidden = true; return; }
  $("#nearby").hidden = false;
  const body = $("#nearbyBody");

  let html = "";
  if (place.kind === "dining") html += `<p class="muted">${esc(t("menuMissing"))}</p>`;

  const closest = PLACES.filter(p => p.id !== toId)
    .map(p => ({ p, m: meters(place, p) }))
    .sort((a, b) => a.m - b.m).slice(0, 4);
  const fallback = closest.map(({ p, m }) =>
    `<div class="train"><span>${esc(p.name)}</span><span class="muted">${esc(t("minWalk", { min: mins(m * WALK_DETOUR / WALK_MPS) }))}</span></div>`).join("");
  body.innerHTML = html + fallback;

  if (!CONFIG.GEMINI_API_KEY) return;
  try {
    const items = await cached(`nearby:${toId}:${lang}`, 30 * 60 * 1000, () => askGemini(place.name));
    if (current && current.toId === toId) {
      body.innerHTML = html + items.map(i =>
        `<div class="train"><span>${esc(i.name)}</span><span class="muted">${esc(i.hint || "")}</span></div>`).join("");
    }
  } catch (err) {
    console.warn("[Lupus] Gemini:", err);
  }
}

async function askGemini(placeName) {
  if (!limiter.take()) throw new Error("rate limited");
  const prompt = `List 4 food spots or useful landmarks within a 5 minute walk of ${placeName} at Stony Brook University. ` +
    `Reply only with a JSON array of objects {"name": string, "hint": string}. Write hints in language code "${lang}".`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }) });
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// ---------- voice (ElevenLabs or browser speech) ----------

let audio = null, speaking = false;

function stopSpeaking() {
  speaking = false;
  speechSynthesis.cancel();
  if (audio) { audio.pause(); audio = null; }
  $("#speak").textContent = t("speak");
}

async function speak() {
  if (speaking) return stopSpeaking();
  if (!current) return;
  const text = optionSteps(current.options[current.selected], current.toId).map(s => s.replace("↳ ", "")).join(". ");
  speaking = true;
  $("#speak").textContent = t("stop");

  if (CONFIG.ELEVENLABS_API_KEY) {
    try {
      const url = await cached(`tts:${lang}:${text}`, 60 * 60 * 1000, () => elevenLabs(text));
      if (!speaking) return;
      audio = new Audio(url);
      audio.onended = stopSpeaking;
      return audio.play();
    } catch (err) {
      console.warn("[Lupus] ElevenLabs, falling back to browser speech:", err);
    }
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[lang];
  u.onend = stopSpeaking;
  speechSynthesis.speak(u);
}

async function elevenLabs(text) {
  if (!limiter.take()) throw new Error("rate limited");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": CONFIG.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(res.status);
  return URL.createObjectURL(await res.blob());
}

// ---------- saved places ----------

function renderSaved() {
  const saved = store.get("saved", []);
  $("#savedChips").innerHTML = saved.filter(node).map(id => `<button class="chip" data-id="${id}">★ ${esc(node(id).name)}</button>`).join("");
  $("#savedChips").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    $("#to").value = node(b.dataset.id).name;
    go();
  }));
}

$("#saveDest").addEventListener("click", () => {
  if (!current) return;
  const saved = store.get("saved", []);
  const i = saved.indexOf(current.toId);
  i >= 0 ? saved.splice(i, 1) : saved.push(current.toId);
  store.set("saved", saved);
  renderSaved();
  render();
});

// ---------- class schedule ----------

function renderClasses() {
  $("#classPlace").innerHTML = PLACES.filter(p => p.kind !== "parking" && p.kind !== "transit")
    .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const names = ["", "M", "T", "W", "Th", "F"];
  const classes = store.get("classes", []);
  $("#classList").innerHTML = classes.map((c, i) =>
    `<li><span><b>${esc(c.name)}</b> · ${esc(node(c.place)?.name || "?")}<br>
     <span class="muted">${c.days.map(d => names[d]).join("")} ${fmtTime(hhmmToMin(c.time))}</span></span>
     <button data-i="${i}" aria-label="Remove">✕</button></li>`).join("");
  $("#classList").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    classes.splice(+b.dataset.i, 1);
    store.set("classes", classes);
    renderClasses();
  }));
}

$("#classForm").addEventListener("submit", e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const days = f.getAll("d").map(Number);
  if (!days.length) return;
  const classes = store.get("classes", []);
  classes.push({ name: f.get("name"), place: f.get("place"), days, time: f.get("time") });
  store.set("classes", classes);
  e.target.reset();
  renderClasses();
});

function nextClass() {
  const classes = store.get("classes", []);
  const now = new Date();
  for (let offset = 0; offset < 7; offset++) {
    const day = (now.getDay() + offset) % 7;
    const todays = classes.filter(c => c.days.includes(day))
      .filter(c => offset > 0 || hhmmToMin(c.time) > nowMin())
      .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
    if (todays.length) return { cls: todays[0], today: offset === 0 };
  }
  return null;
}

$("#nextClass").addEventListener("click", () => {
  const next = nextClass();
  if (!next) return alertMsg(t("noClass"));
  if (!$("#from").value) $("#from").value = extraNodes.me ? t("myLocation") : node("sac").name;
  $("#to").value = node(next.cls.place).name;
  $("#when").value = "now";
  $("#whenTime").hidden = true;
  go(next.cls.name);
  if (current && next.today) {
    const best = current.options[0];
    const leaveBy = hhmmToMin(next.cls.time) - (best.arrive - current.tMin);
    current.title = t("leaveBy", { time: fmtTime(leaveBy), cls: next.cls.name, at: fmtTime(hhmmToMin(next.cls.time)) });
    render();
  }
});

// ---------- shortcuts list ----------

function renderShortcuts() {
  const m = nowMin();
  $("#shortcutList").innerHTML = SHORTCUTS.map(sc =>
    `<li><span><b>${esc(sc.name)}</b><br><span class="muted">${esc(t("openHours", { open: fmtTime(sc.open * 60), close: fmtTime(sc.close * 60) }))}</span></span>
     <span class="${isOpen(sc, m) ? "ok" : "miss"}">${esc(isOpen(sc, m) ? t("now") : t("closed"))}</span></li>`).join("");
}

// ---------- wiring ----------

$("#go").addEventListener("click", () => go());
["#from", "#to"].forEach(s => $(s).addEventListener("keydown", e => { if (e.key === "Enter") go(); }));
$("#swap").addEventListener("click", () => {
  [$("#from").value, $("#to").value] = [$("#to").value, $("#from").value];
  if ($("#from").value && $("#to").value) go();
});
$("#when").addEventListener("change", () => { $("#whenTime").hidden = $("#when").value !== "at"; });
$("#speak").addEventListener("click", speak);
$("#lang").value = lang;
$("#lang").addEventListener("change", e => {
  lang = e.target.value;
  store.set("lang", lang);
  stopSpeaking();
  applyI18n();
});

$("#locate").addEventListener("click", () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const me = { id: "me", name: t("myLocation"), lat: pos.coords.latitude, lng: pos.coords.longitude, kind: "me" };
    if (meters(me, node("sac")) > 4000) {
      return alertMsg("Your location looks off campus. Pick a starting place instead.");
    }
    extraNodes.me = me;
    $("#from").value = t("myLocation");
    if (meMarker) meMarker.remove();
    meMarker = L.circleMarker([me.lat, me.lng], { radius: 7, color: "#fff", weight: 3, fillColor: "#3182ce", fillOpacity: 1 }).addTo(map);
    if ($("#to").value) go();
  }, err => alertMsg(err.message));
});

$("#from").value = node("sac").name;
applyI18n();
