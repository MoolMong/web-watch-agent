const $ = (id) => document.getElementById(id);
const won = (n) => (n == null ? "-" : "₩" + Number(n).toLocaleString("ko-KR"));
const pct = (p) => (p == null ? "-" : Math.round(p * 100) + "%");
const when = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const WATCHER = "flights";
let sb;

// ---- airports ----
const AIRPORT_BY_CODE = Object.fromEntries(window.AIRPORTS.map((a) => [a[0], a]));
const COUNTRY_ORDER = Object.keys(window.COUNTRIES);
function airportLabel(code) {
  const a = AIRPORT_BY_CODE[code];
  return a ? `${a[2]} ${a[1]} (${a[0]})` : code || "";
}

// ---- data ----
async function loadData() {
  const [cfgRes, latestRes] = await Promise.all([
    sb.from("watch_configs").select("config").eq("watcher", WATCHER).maybeSingle(),
    sb.from("watch_checks").select("checked_at, config_key, snapshot").eq("watcher", WATCHER).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (cfgRes.error) throw cfgRes.error;
  if (latestRes.error) throw latestRes.error;
  let points = [];
  if (latestRes.data) {
    const hist = await sb.from("watch_checks").select("checked_at, summary").eq("watcher", WATCHER)
      .eq("config_key", latestRes.data.config_key).order("checked_at", { ascending: true }).limit(500);
    if (hist.error) throw hist.error;
    points = hist.data.map((r) => ({ checkedAt: r.checked_at, ...r.summary }));
  }
  return { config: cfgRes.data?.config ?? null, latest: latestRes.data?.snapshot ?? null, points };
}

async function refresh() {
  const { config, latest, points } = await loadData();
  if (config) setupForm(config);
  if (!latest) {
    $("verdict").innerHTML = `<p class="muted">아직 확인 결과가 없습니다. 아래에서 조건을 정하고 <b>이 조건으로 지금 검색</b>을 눌러 보세요.</p>`;
    return;
  }
  renderVerdict(latest);
  renderStats(latest);
  renderChart(points, latest.config.flight.targetPrice);
  renderRows(points);
  renderHotels(latest);
  if (config && JSON.stringify(config.flight) !== JSON.stringify(latest.config.flight)) {
    $("insight").textContent = "조건이 바뀌었습니다. 다음 확인부터 새 조건으로 기록됩니다.";
  }
}

// ---- requests ("지금 검색") ----
let watching = null;
async function requestRun(config) {
  const { data, error } = await sb.from("watch_requests").insert({ watcher: WATCHER, config }).select("id, status, created_at").single();
  if (error) { showStatus("error", `요청을 보내지 못했습니다: ${esc(error.message)}`); return; }
  watchRequest(data);
}

function showStatus(kind, html) {
  const el = $("run-status");
  el.hidden = false;
  el.className = `run-status ${kind}`;
  el.innerHTML = html;
}

function watchRequest(req) {
  if (watching) { sb.removeChannel(watching.channel); clearInterval(watching.timer); }
  const render = async (r) => {
    if (r.status === "pending") {
      const waited = Date.now() - Date.parse(r.created_at);
      showStatus("pending", waited > 60_000
        ? `⏳ 요청 #${r.id}이 1분 넘게 대기 중입니다. PC가 켜져 있고 에이전트가 실행 중인지 확인하세요.`
        : `⏳ 요청 #${r.id}을 PC에 보냈습니다. 곧 시작합니다…`);
    } else if (r.status === "running") {
      showStatus("pending", `🔎 검색 중입니다 (#${r.id}). 보통 1~2분 걸립니다.`);
    } else {
      clearInterval(watching?.timer);
      if (watching) sb.removeChannel(watching.channel);
      watching = null;
      if (r.status === "done") { showStatus("done", `✅ 검색 완료 (#${r.id}) · ${esc(r.message || "")}`); await refresh(); }
      else showStatus("error", `⚠️ 검색 실패 (#${r.id}): ${esc(r.message || "")}`);
    }
  };
  const channel = sb.channel(`req-${req.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "watch_requests", filter: `id=eq.${req.id}` }, (p) => render(p.new))
    .subscribe();
  // Fallback in case realtime is unavailable.
  const timer = setInterval(async () => {
    const { data } = await sb.from("watch_requests").select("id, status, message, created_at").eq("id", req.id).single();
    if (data) render(data);
  }, 5000);
  watching = { channel, timer };
  render(req);
}

async function resumePendingRequest() {
  const { data } = await sb.from("watch_requests").select("id, status, message, created_at")
    .eq("watcher", WATCHER).in("status", ["pending", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (data) watchRequest(data);
}

// ---- rendering ----
function renderVerdict(latest) {
  const v = latest.verdict;
  const el = $("verdict");
  el.className = "card verdict " + (v.alert ? "buy" : "wait");
  const links = [`<a class="button" href="${esc(latest.flight.url)}" target="_blank" rel="noopener">구글 항공권에서 보기</a>`];
  if (latest.hotel) links.push(`<a class="button ghost" href="${esc(latest.hotel.url)}" target="_blank" rel="noopener">호텔 보기</a>`);
  links.push(`<button type="button" class="button ghost" id="rerun">지금 다시 검색</button>`);
  const threshold = Math.round((latest.config.alert?.minBuyProbability ?? 0.7) * 100);
  el.innerHTML = `
    <div class="badge">${v.alert ? "지금 구매 추천" : "기다리세요"}</div>
    <div class="body">
      <p>Jev 판단: 저렴함 <b>${pct(v.isCheap)}</b> · 지금 구매 <b>${pct(v.buyProbability)}</b> <span class="muted">(알림 기준 ${threshold}%)</span>${v.hitTarget ? " · <b>목표가 도달</b>" : ""}</p>
      <p class="muted">${v.alert ? "링크에서 직접 확인하고 결제하세요. 자동 결제는 하지 않습니다." : "구매 확률이 알림 기준을 넘거나 목표가에 닿으면 이 화면이 바뀝니다."}</p>
    </div>
    <div class="actions">${links.join("")}</div>`;
  $("rerun").addEventListener("click", () => requestRun(null));
}

function renderStats(latest) {
  const f = latest.flight, c = latest.config.flight;
  $("s-min").textContent = won(f.minPrice);
  $("s-airline").textContent = f.cheapest?.[0]?.airline || "";
  $("s-med").textContent = won(f.medianPrice);
  $("s-target").textContent = c.targetPrice ? won(c.targetPrice) : "없음";
  $("s-gap").textContent = c.targetPrice ? (f.minPrice <= c.targetPrice ? "목표가 이하" : `목표까지 ${won(f.minPrice - c.targetPrice)}`) : "";
  if (!latest.hotel) $("s-hotel").textContent = "확인 안 함";
  $("trip").textContent = `${airportLabel(c.origin)} → ${airportLabel(c.destination)} · ${c.departDate}${c.returnDate ? " ~ " + c.returnDate : " 편도"} · 성인 ${c.adults}`;
  $("insight").textContent = f.googleInsight ? "Google: " + f.googleInsight : "";
  $("updated").textContent = ` 마지막 확인: ${new Date(latest.checkedAt).toLocaleString("ko-KR")}`;
}

function renderChart(points, target) {
  const box = $("chart");
  if (points.length < 2) {
    box.innerHTML = `<div class="empty">기록이 2개 이상 쌓이면 그래프가 나타납니다. (현재 ${points.length}개)</div>`;
    return;
  }
  const W = 900, H = 260, L = 70, R = 16, T = 14, B = 30;
  const ys = points.map((p) => p.minPrice).concat(target ? [target] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max((hi - lo) * 0.12, 5000); lo -= pad; hi += pad;
  const x = (i) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = 4, grid = [];
  for (let k = 0; k <= ticks; k++) {
    const v = lo + ((hi - lo) * k) / ticks, yy = y(v).toFixed(1);
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--grid)"/>`,
      `<text x="${L - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="var(--muted)">${Math.round(v / 1000).toLocaleString("ko-KR")}천</text>`);
  }
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.minPrice).toFixed(1)}`).join("");
  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.minPrice).toFixed(1)}" r="${p.alert ? 4.5 : 3}" fill="${p.alert ? "var(--good)" : "var(--line)"}"><title>${when(p.checkedAt)} ${won(p.minPrice)}</title></circle>`).join("");
  const tgt = target ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--target)" stroke-dasharray="5 5"/>
    <text x="${W - R}" y="${y(target) - 6}" text-anchor="end" font-size="12" fill="var(--target)">목표 ${won(target)}</text>` : "";
  const xl = [0, points.length - 1].map((i) =>
    `<text x="${x(i)}" y="${H - 8}" text-anchor="${i ? "end" : "start"}" font-size="12" fill="var(--muted)">${when(points[i].checkedAt)}</text>`).join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최저가 추이">${grid.join("")}${tgt}
    <path d="${path}" fill="none" stroke="var(--line)" stroke-width="2.5" stroke-linejoin="round"/>${dots}${xl}</svg>`;
}

function renderRows(points) {
  $("rows").innerHTML = points.slice(-20).reverse().map((p) => `
    <tr><td>${when(p.checkedAt)}</td><td class="num">${won(p.minPrice)}</td><td class="num">${pct(p.isCheap)}</td>
    <td class="num">${pct(p.buyProbability)}</td><td><span class="tag ${p.alert ? "buy" : "wait"}">${p.alert ? "구매" : "대기"}</span></td></tr>`).join("")
    || `<tr><td colspan="5" class="muted">아직 기록이 없습니다.</td></tr>`;
}

// ---- hotels ----
const TAG_LABEL = { capsule: "캡슐호텔", dorm: "공유방", private: "개인실" };
let hotelData = null;

function drawHotels() {
  const h = hotelData;
  if (!h?.list) return;
  const c = h.config;
  const exCapsule = $("ex-capsule").checked, exDorm = $("ex-dorm").checked, sort = $("hotel-sort").value;
  store.set("ex-capsule", exCapsule); store.set("ex-dorm", exDorm); store.set("hotel-sort", sort);
  const shown = h.list
    .filter((x) => !(exCapsule && x.tag === "capsule") && !(exDorm && x.tag === "dorm"))
    .sort((a, b) => sort === "rating" ? (b.rating ?? 0) - (a.rating ?? 0) || a.price - b.price : a.price - b.price);
  const hidden = h.list.length - shown.length;
  $("hotel-meta").textContent = `${c.query || ""} · ${c.minRating ? `평점 ${Number(c.minRating).toFixed(1)} 이상 · ` : ""}${shown.length}곳${hidden ? ` (${hidden}곳 숨김)` : ""}`;
  $("s-hotel").textContent = shown.length ? won(Math.min(...shown.map((x) => x.price))) : "-";
  $("hotels").innerHTML = shown.map((x) => {
    const q = encodeURIComponent(`${x.name} ${c.checkIn || ""} to ${c.checkOut || ""}`);
    const tag = x.tag ? `<span class="tag lodging ${x.tag}" title="Jev 확신도 ${pct(x.tagConfidence)}">${TAG_LABEL[x.tag] || esc(x.tag)}</span>` : "";
    return `<li class="hotel">
      <div class="hotel-main">
        <a href="https://www.google.com/travel/search?q=${q}&hl=ko&curr=KRW" target="_blank" rel="noopener">${esc(x.name)}</a>
        <span class="hotel-sub">${x.rating != null ? `★ ${x.rating.toFixed(1)}` : "평점 없음"}${x.reviews ? ` (${x.reviews.toLocaleString("ko-KR")})` : ""}${x.stars ? ` · ${x.stars}성급` : ""}${x.deal ? ` · ${esc(x.deal)}` : ""}</span>
      </div>
      <div class="hotel-side">${tag}<b>${won(x.price)}</b></div>
    </li>`;
  }).join("") || `<li class="muted">조건에 맞는 숙소가 없습니다.</li>`;
}

function renderHotels(latest) {
  if (!latest.hotel?.list) { $("hotel-card").hidden = true; return; }
  hotelData = { list: latest.hotel.list, config: latest.config.hotel || {} };
  $("hotel-card").hidden = false;
  drawHotels();
}

function setupHotelFilters() {
  $("ex-capsule").checked = store.get("ex-capsule", false);
  $("ex-dorm").checked = store.get("ex-dorm", false);
  $("hotel-sort").value = store.get("hotel-sort", "price");
  ["ex-capsule", "ex-dorm", "hotel-sort"].forEach((id) => $(id).addEventListener("change", drawHotels));
}

// ---- airport combobox ----
function searchAirports(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hits = window.AIRPORTS.filter(([code, name, cityKo, cityEn, cc]) =>
    [code, name, cityKo, cityEn, ...(window.COUNTRIES[cc] || [])].join(" ").toLowerCase().includes(q));
  return hits.sort((a, b) => (b[0].toLowerCase() === q) - (a[0].toLowerCase() === q) || b[5] - a[5]);
}

// How often each airport was used, per field: past search requests (any device) + picks on this browser.
const frequent = { origin: {}, destination: {} };
function bump(field, code, n = 1) { if (code) frequent[field][code] = (frequent[field][code] || 0) + n; }
async function loadFrequent() {
  const local = store.get("airport-picks", { origin: {}, destination: {} });
  for (const f of ["origin", "destination"]) for (const [c, n] of Object.entries(local[f] || {})) bump(f, c, n);
  const { data } = await sb.from("watch_requests").select("config").eq("watcher", WATCHER)
    .not("config", "is", null).order("created_at", { ascending: false }).limit(200);
  for (const r of data || []) { bump("origin", r.config?.flight?.origin); bump("destination", r.config?.flight?.destination); }
}
function rememberPick(field, code) {
  const local = store.get("airport-picks", { origin: {}, destination: {} });
  local[field] = local[field] || {};
  local[field][code] = (local[field][code] || 0) + 1;
  store.set("airport-picks", local);
  bump(field, code);
}

const combos = {};
function setupCombo(field) {
  const box = document.querySelector(`.combo[data-field="${field}"]`);
  const input = box.querySelector("[role=combobox]");
  const hidden = box.querySelector("input[type=hidden]");
  const list = box.querySelector("[role=listbox]");
  let active = -1;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const choose = (code) => { hidden.value = code; input.value = airportLabel(code); close(); rememberPick(field, code); };
  const row = (a, i) => `<li role="option" id="${field}-opt-${i}" data-code="${a[0]}" class="combo-item">
      <span class="code">${a[0]}</span><span class="name">${esc(a[2])} · ${esc(a[1])}</span><span class="country">${esc(window.COUNTRIES[a[4]]?.[0] || "")}</span></li>`;
  const group = (title, airports, start) =>
    `<li class="combo-group" role="presentation">${esc(title)}</li>` + airports.map((a, j) => row(a, start + j)).join("");
  const open = () => {
    const hits = searchAirports(input.value === airportLabel(hidden.value) ? "" : input.value);
    let html = "", n = 0;
    if (hits) {
      html = hits.slice(0, 40).map((a) => row(a, n++)).join("") || `<li class="combo-empty">결과 없음. 공항 코드(예: NRT)로도 찾을 수 있습니다.</li>`;
    } else {
      // No query: airports used most often first, then every country with airports by size.
      const top = Object.entries(frequent[field]).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([c]) => AIRPORT_BY_CODE[c]).filter(Boolean);
      if (top.length) { html += group("자주 찾은 공항", top, n); n += top.length; }
      for (const cc of COUNTRY_ORDER) {
        const g = window.AIRPORTS.filter((a) => a[4] === cc).sort((a, b) => b[5] - a[5]);
        if (g.length) { html += group(window.COUNTRIES[cc][0], g, n); n += g.length; }
      }
    }
    list.innerHTML = html;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    active = -1;
  };
  const highlight = (i) => {
    const opts = list.querySelectorAll("[role=option]");
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, k) => o.classList.toggle("active", k === active));
    opts[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", opts[active].id);
  };

  input.addEventListener("focus", () => { input.select(); open(); });
  input.addEventListener("click", open);
  input.addEventListener("input", open);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter" && !list.hidden) {
      e.preventDefault();
      const opts = list.querySelectorAll("[role=option]");
      const pick = opts[active >= 0 ? active : 0];
      if (pick) choose(pick.dataset.code);
    } else if (e.key === "Escape") { close(); input.value = airportLabel(hidden.value); }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[role=option]");
    if (li) { e.preventDefault(); choose(li.dataset.code); }
  });
  input.addEventListener("blur", () => { close(); input.value = airportLabel(hidden.value); });
  combos[field] = { set: (code) => { hidden.value = code; input.value = airportLabel(code); }, get: () => hidden.value };
}

// ---- date range picker: first click = 가는 날, next later click = 오는 날 ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmtDay = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };

const dates = { depart: "", ret: "", picking: "depart", viewMonth: null };
function updateDateButton() {
  const b = $("date-button");
  const f = $("cfg").elements;
  f.departDate.value = dates.depart; f.returnDate.value = dates.ret;
  if (!dates.depart) { b.textContent = "날짜 선택"; return; }
  if (!dates.ret) { b.textContent = `${fmtDay(dates.depart)} · 편도`; return; }
  const nights = Math.round((parseISO(dates.ret) - parseISO(dates.depart)) / 86_400_000);
  b.textContent = `${fmtDay(dates.depart)} ~ ${fmtDay(dates.ret)} · ${nights}박`;
}

function renderCalendar() {
  const cal = $("calendar");
  const today = iso(new Date());
  const month = (offset) => {
    const first = new Date(dates.viewMonth.getFullYear(), dates.viewMonth.getMonth() + offset, 1);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    let cells = DOW.map((d) => `<span class="dow">${d}</span>`).join("") + "<span></span>".repeat(first.getDay());
    for (let d = 1; d <= days; d++) {
      const s = iso(new Date(first.getFullYear(), first.getMonth(), d));
      const cls = ["day"];
      if (s < today) cls.push("past");
      if (s === dates.depart) cls.push("start");
      if (s === dates.ret) cls.push("end");
      if (dates.depart && dates.ret && s > dates.depart && s < dates.ret) cls.push("between");
      cells += `<button type="button" class="${cls.join(" ")}" data-date="${s}" ${s < today ? "disabled" : ""}>${d}</button>`;
    }
    return `<div class="month"><div class="month-title">${first.getFullYear()}년 ${first.getMonth() + 1}월</div><div class="days">${cells}</div></div>`;
  };
  const hint = dates.picking === "depart" ? "가는 날을 고르세요" : "오는 날을 고르세요 (편도면 '편도')";
  cal.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="이전 달">‹</button>
      <span class="cal-hint">${hint}</span>
      <button type="button" class="cal-nav" data-nav="1" aria-label="다음 달">›</button>
    </div>
    <div class="months">${month(0)}${month(1)}</div>
    <div class="cal-foot">
      <button type="button" class="button ghost" data-act="oneway">편도</button>
      <button type="button" class="button" data-act="done">완료</button>
    </div>`;
}

function openCalendar() {
  dates.picking = "depart";
  dates.viewMonth = dates.depart ? parseISO(dates.depart) : new Date();
  dates.viewMonth.setDate(1);
  renderCalendar();
  $("calendar").hidden = false;
  $("date-button").setAttribute("aria-expanded", "true");
}
function closeCalendar() { $("calendar").hidden = true; $("date-button").setAttribute("aria-expanded", "false"); }

function setupCalendar() {
  $("date-button").addEventListener("click", () => ($("calendar").hidden ? openCalendar() : closeCalendar()));
  $("calendar").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { dates.viewMonth.setMonth(dates.viewMonth.getMonth() + Number(nav.dataset.nav)); renderCalendar(); return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "oneway") { dates.ret = ""; updateDateButton(); closeCalendar(); return; }
    if (act === "done") { closeCalendar(); return; }
    const day = e.target.closest("[data-date]")?.dataset.date;
    if (!day) return;
    if (dates.picking === "depart" || day < dates.depart) {
      dates.depart = day; dates.ret = ""; dates.picking = "return";
      updateDateButton(); renderCalendar();
    } else {
      dates.ret = day; dates.picking = "depart";
      updateDateButton(); closeCalendar();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!$("calendar").hidden && !e.target.closest(".dates")) closeCalendar();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCalendar(); });
}

// ---- config form ----
function setSelect(select, value) {
  const v = String(value);
  if (![...select.options].some((o) => o.value === v)) select.add(new Option(v, v));
  select.value = v;
}

function syncHotelFields() {
  const on = $("cfg").elements.hotelEnabled.checked;
  document.querySelectorAll(".hotel-input, .hotel-rating").forEach((el) => el.classList.toggle("disabled", !on));
  document.querySelectorAll(".hotel-input, #minRating").forEach((el) => (el.disabled = !on));
}

let formReady = false;
function setupForm(cfg) {
  // Fill once; later refreshes must not overwrite what the user is editing.
  if (formReady) return;
  formReady = true;
  const f = $("cfg").elements, c = cfg.flight, h = cfg.hotel || {};
  combos.origin.set(c.origin);
  combos.destination.set(c.destination);
  dates.depart = c.departDate; dates.ret = c.returnDate || "";
  updateDateButton();
  f.adults.value = c.adults; f.targetPrice.value = c.targetPrice;
  setSelect(f.minBuy, Math.round((cfg.alert?.minBuyProbability ?? 0.7) * 100));
  f.hotelEnabled.checked = !!h.enabled; f.hotelQuery.value = h.query || "";
  setSelect(f.minRating, Number(h.minRating) || 0);
  syncHotelFields();
}

function buildConfig() {
  const f = $("cfg").elements;
  const flight = {
    origin: f.origin.value, destination: f.destination.value,
    departDate: f.departDate.value, returnDate: f.returnDate.value,
    adults: Number(f.adults.value), currency: "KRW", targetPrice: Number(f.targetPrice.value),
  };
  return {
    flight,
    hotel: {
      enabled: f.hotelEnabled.checked, query: f.hotelQuery.value.trim(),
      checkIn: flight.departDate, checkOut: flight.returnDate, minRating: Number(f.minRating.value),
    },
    alert: { minBuyProbability: Number(f.minBuy.value) / 100 },
  };
}

function setupFormEvents() {
  setupCombo("origin");
  setupCombo("destination");
  setupCalendar();
  $("swap").addEventListener("click", () => {
    const o = combos.origin.get(), d = combos.destination.get();
    combos.origin.set(d); combos.destination.set(o);
  });
  // Target price: ▲▼ buttons and arrow keys (input step) move by 10,000원.
  const price = $("targetPrice");
  document.querySelectorAll(".stepper [data-step]").forEach((b) => b.addEventListener("click", () => {
    price.value = Math.max(0, Math.round((Number(price.value) || 0) / 10000) * 10000 + Number(b.dataset.step));
  }));
  $("minbuy-info").addEventListener("click", () => {
    const help = $("minbuy-help");
    help.hidden = !help.hidden;
    $("minbuy-info").setAttribute("aria-expanded", String(!help.hidden));
  });
  $("cfg").elements.hotelEnabled.addEventListener("change", syncHotelFields);
  $("cfg").addEventListener("submit", (e) => {
    e.preventDefault();
    const cfg = buildConfig();
    const msg = $("form-msg");
    if (!cfg.flight.origin || !cfg.flight.destination) { msg.textContent = "출발·도착 공항을 목록에서 골라 주세요."; return; }
    if (cfg.flight.origin === cfg.flight.destination) { msg.textContent = "출발과 도착 공항이 같습니다."; return; }
    if (!cfg.flight.departDate) { msg.textContent = "날짜를 골라 주세요."; return; }
    msg.textContent = "";
    requestRun(cfg);
  });
}

(async () => {
  try { await window.wwa.requireLogin(document.querySelector("main")); } catch { return; }
  sb = window.wwa.sb;
  $("logout").hidden = false;
  $("logout").addEventListener("click", window.wwa.logout);
  setupFormEvents();
  setupHotelFilters();
  try {
    await Promise.all([refresh(), loadFrequent().catch((e) => console.warn("frequent airports:", e))]);
    await resumePendingRequest();
  } catch (e) {
    $("verdict").innerHTML = `<p class="muted">데이터를 불러오지 못했습니다: ${esc(e.message)}</p>`;
    console.error(e);
  }
})();
