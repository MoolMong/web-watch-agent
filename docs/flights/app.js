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
const MAX_BULK = 30;
let sb;

// ---- airports ----
const AIRPORT_BY_CODE = Object.fromEntries(window.AIRPORTS.map((a) => [a[0], a]));
const COUNTRY_ORDER = Object.keys(window.COUNTRIES);
function airportLabel(code) {
  const a = AIRPORT_BY_CODE[code];
  return a ? `${a[2]} ${a[1]} (${a[0]})` : code || "";
}
const cityOf = (code) => AIRPORT_BY_CODE[code]?.[2] || code;

// ---- dates ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmtDay = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };
const nightsOf = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86_400_000);
const rangeLabel = (a, b) => (b ? `${fmtDay(a)} ~ ${fmtDay(b)} · ${nightsOf(a, b)}박` : `${fmtDay(a)} · 편도`);

// ---- state ----
const state = {
  watches: [],          // rows from `watches`
  selectedId: null,     // watch shown in the detail area
  editingId: null,      // watch loaded in the editor (null = new)
  checked: new Set(),   // rows ticked for bulk actions
  bulk: false,          // editor in "여러 개 한 번에" mode
  multi: { origin: [], destination: [], dates: [] }, // bulk-mode selections
};

const watchTitle = (c) => `${cityOf(c.flight.origin)} → ${cityOf(c.flight.destination)}`;
const watchDates = (c) => rangeLabel(c.flight.departDate, c.flight.returnDate);
function watchSub(c) {
  const parts = [`성인 ${c.flight.adults}`];
  if (c.flight.targetPrice) parts.push(`목표 ${won(c.flight.targetPrice)}`);
  if (c.hotel?.enabled) parts.push(`호텔 ${c.hotel.query || ""}${c.hotel.minRating ? ` ★${Number(c.hotel.minRating).toFixed(1)}+` : ""}`);
  return parts.join(" · ");
}

// =====================================================================
// Watch list
// =====================================================================
async function loadWatches() {
  const { data, error } = await sb.from("watches").select("*").eq("watcher", WATCHER).order("created_at", { ascending: true });
  if (error) throw error;
  state.watches = data;
  for (const id of [...state.checked]) if (!data.some((w) => w.id === id)) state.checked.delete(id);
  renderWatchList();
}

function renderWatchList() {
  const rows = state.watches;
  $("watch-count").textContent = rows.length ? rows.length : "";
  $("watch-rows").innerHTML = rows.map((w) => {
    const c = w.config, s = w.last_summary;
    const past = c.flight.departDate < iso(new Date());
    const verdict = past ? `<span class="tag wait" title="${esc(w.last_error || "출발일이 지났습니다")}">지난 일정</span>`
      : w.last_error ? `<span class="tag error" title="${esc(w.last_error)}">오류</span>`
      : !s ? `<span class="tag wait">대기 중</span>`
      : `<span class="tag ${s.alert ? "buy" : "wait"}">${s.alert ? "구매 추천" : "기다리기"}</span>`;
    // Change since the previous check and the lowest fare seen for these conditions.
    const diff = s && w.prev_summary?.minPrice != null ? s.minPrice - w.prev_summary.minPrice : null;
    const trend = diff == null || diff === 0 ? ""
      : `<span class="trend ${diff < 0 ? "down" : "up"}" title="직전 확인 대비">${diff < 0 ? "▼" : "▲"} ${won(Math.abs(diff))}</span>`;
    const lowest = w.lowest_price != null && s && w.lowest_price < s.minPrice ? `<span class="lowest">최저 ${won(w.lowest_price)}</span>`
      : w.lowest_price != null && s && w.prev_summary ? `<span class="lowest best">지금이 최저</span>` : "";
    return `<tr class="${w.id === state.selectedId ? "selected" : ""} ${w.enabled ? "" : "off"}" data-id="${w.id}">
      <td class="col-check"><input type="checkbox" data-check="${w.id}" ${state.checked.has(w.id) ? "checked" : ""} aria-label="선택"></td>
      <td class="watch-cell">
        <button type="button" class="watch-name" data-open="${w.id}">${esc(watchTitle(c))} <span class="watch-dates">${esc(watchDates(c))}</span></button>
        <span class="watch-sub">${esc(watchSub(c))}</span>
      </td>
      <td class="num price-cell">${s ? `<b>${won(s.minPrice)}</b>${trend}${lowest}` : "-"}</td>
      <td>${verdict}</td>
      <td class="muted">${w.last_checked_at ? when(w.last_checked_at) : "-"}</td>
      <td class="col-on"><label class="switch mini"><input type="checkbox" data-toggle="${w.id}" ${w.enabled ? "checked" : ""} aria-label="자동 확인"><span class="track"></span></label></td>
      <td class="col-actions">
        <button type="button" class="icon-btn" data-run="${w.id}" title="지금 검색" aria-label="지금 검색">↻</button>
        <button type="button" class="icon-btn" data-edit="${w.id}" title="편집" aria-label="편집">✎</button>
        <button type="button" class="icon-btn" data-copy="${w.id}" title="복제" aria-label="복제">⧉</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty-row">아직 감시가 없습니다. 위에서 조건을 정하고 <b>추가하고 검색</b>을 누르세요.</td></tr>`;
  $("check-all").checked = rows.length > 0 && rows.every((w) => state.checked.has(w.id));
  renderBulkBar();
}

function renderBulkBar() {
  const n = state.checked.size;
  $("bulk-bar").hidden = n === 0;
  $("bulk-count").textContent = `${n}개 선택`;
}

function setupWatchList() {
  $("watch-rows").addEventListener("click", async (e) => {
    const t = e.target;
    const id = (attr) => Number(t.closest(`[${attr}]`)?.getAttribute(attr));
    if (t.matches("[data-check]")) { t.checked ? state.checked.add(id("data-check")) : state.checked.delete(id("data-check")); renderBulkBar(); return; }
    if (t.matches("[data-toggle]")) { await setEnabled([id("data-toggle")], t.checked); return; }
    if (t.closest("[data-run]")) { await requestRuns([id("data-run")]); return; }
    if (t.closest("[data-edit]")) { const w = findWatch(id("data-edit")); editWatch(w); return; }
    if (t.closest("[data-copy]")) { const w = findWatch(id("data-copy")); copyWatch(w); return; }
    const row = t.closest("tr[data-id]");
    if (row && !t.closest("input,button,label")) selectWatch(Number(row.dataset.id));
    if (t.closest("[data-open]")) selectWatch(id("data-open"));
  });
  $("check-all").addEventListener("change", (e) => {
    state.checked = e.target.checked ? new Set(state.watches.map((w) => w.id)) : new Set();
    renderWatchList();
  });
  $("bulk-bar").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-bulk]")?.dataset.bulk;
    const ids = [...state.checked];
    if (!act || !ids.length) return;
    if (act === "run") await requestRuns(ids);
    if (act === "on") await setEnabled(ids, true);
    if (act === "off") await setEnabled(ids, false);
    if (act === "delete") {
      if (!confirm(`감시 ${ids.length}개와 그 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      const { error } = await sb.from("watches").delete().in("id", ids);
      if (error) return showStatus("error", `삭제하지 못했습니다: ${esc(error.message)}`);
      if (ids.includes(state.editingId)) startNew();
      if (ids.includes(state.selectedId)) state.selectedId = null;
      state.checked.clear();
      await loadWatches();
      await showDetail();
    }
  });
}

const findWatch = (id) => state.watches.find((w) => w.id === id);

async function setEnabled(ids, enabled) {
  const { error } = await sb.from("watches").update({ enabled, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) return showStatus("error", `변경하지 못했습니다: ${esc(error.message)}`);
  await loadWatches();
}

// =====================================================================
// Requests ("검색")
// =====================================================================
let tracking = null;
async function requestRuns(watchIds) {
  if (!watchIds.length) return;
  const rows = watchIds.map((id) => ({ watcher: WATCHER, watch_id: id }));
  const { data, error } = await sb.from("watch_requests").insert(rows).select("id, watch_id, status, created_at");
  if (error) return showStatus("error", `요청을 보내지 못했습니다: ${esc(error.message)}`);
  trackRequests(data);
}

function showStatus(kind, html) {
  const el = $("run-status");
  el.hidden = false;
  el.className = `run-status ${kind}`;
  el.innerHTML = html;
}

function trackRequests(reqs) {
  if (tracking) clearInterval(tracking.timer);
  const ids = reqs.map((r) => r.id);
  const started = Date.now();
  const tick = async () => {
    const { data } = await sb.from("watch_requests").select("id, watch_id, status, message").in("id", ids);
    if (!data) return;
    const by = (s) => data.filter((r) => r.status === s).length;
    const done = by("done"), failed = by("error"), running = by("running"), pending = by("pending");
    const total = data.length;
    if (done + failed === total) {
      clearInterval(tracking.timer); tracking = null;
      const fail = data.filter((r) => r.status === "error");
      showStatus(failed ? "error" : "done", failed
        ? `⚠️ ${total}개 중 ${failed}개 실패: ${esc(fail[0].message || "")}`
        : total === 1 ? `✅ 검색 완료 · ${esc(data[0].message || "")}` : `✅ ${total}개 검색 완료`);
      await loadWatches();
      await showDetail();
      return;
    }
    const offline = window.wwa.agent.row && !window.wwa.agent.online;
    const slow = pending === total && Date.now() - started > 60_000;
    showStatus("pending", offline && pending === total
      ? `⏸ PC가 꺼져 있어 요청이 대기 중입니다. PC를 켜고 로그인하면 자동으로 이어서 검색합니다.`
      : slow
      ? `⏳ 1분 넘게 대기 중입니다. PC가 켜져 있고 에이전트가 실행 중인지 확인하세요.`
      : `🔎 ${total > 1 ? `${total}개 중 ${done + failed}개 완료 · ` : ""}${running ? "검색 중" : "PC에 보냄"}… 하나에 30초 안팎 걸립니다.`);
    if (done) await loadWatches();
  };
  tracking = { timer: setInterval(tick, 3000) };
  tick();
}

async function resumePendingRequests() {
  const { data } = await sb.from("watch_requests").select("id, watch_id, status, created_at")
    .eq("watcher", WATCHER).in("status", ["pending", "running"]).order("created_at", { ascending: false }).limit(50);
  if (data?.length) trackRequests(data);
}

// =====================================================================
// Detail of the selected watch
// =====================================================================
function selectWatch(id) {
  state.selectedId = id;
  store.set("selected-watch", id);
  renderWatchList();
  showDetail().then(() => $("detail").scrollIntoView({ behavior: "smooth", block: "start" }));
}

async function showDetail() {
  const w = findWatch(state.selectedId);
  $("detail").hidden = !w;
  if (!w) return;
  $("detail-label").textContent = `선택한 감시 · ${watchTitle(w.config)} · ${watchDates(w.config)}`;
  const latestRes = await sb.from("watch_checks").select("checked_at, config_key, snapshot")
    .eq("watch_id", w.id).order("checked_at", { ascending: false }).limit(1).maybeSingle();
  if (latestRes.error) throw latestRes.error;
  const latest = latestRes.data?.snapshot;
  if (!latest) {
    $("verdict").className = "card verdict";
    $("verdict").innerHTML = `<p class="muted">아직 확인 결과가 없습니다. 목록에서 ↻ 를 누르면 바로 검색합니다.</p>`;
    for (const id of ["s-min", "s-med", "s-target", "s-hotel"]) $(id).textContent = "-";
    $("chart").innerHTML = ""; $("rows").innerHTML = ""; $("hotel-card").hidden = true; $("insight").textContent = "";
    return;
  }
  const hist = await sb.from("watch_checks").select("checked_at, summary").eq("watch_id", w.id)
    .eq("config_key", latestRes.data.config_key).order("checked_at", { ascending: true }).limit(500);
  if (hist.error) throw hist.error;
  const points = hist.data.map((r) => ({ checkedAt: r.checked_at, ...r.summary }));
  renderVerdict(latest, w);
  renderStats(latest);
  renderChart(points, latest.config.flight.targetPrice);
  renderRows(points);
  renderHotels(latest);
  if (JSON.stringify(w.config.flight) !== JSON.stringify(latest.config.flight)) {
    $("insight").textContent = "조건이 바뀌었습니다. 다음 확인부터 새 조건으로 기록됩니다.";
  }
}

function renderVerdict(latest, w) {
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
  $("rerun").addEventListener("click", () => requestRuns([w.id]));
}

function renderStats(latest) {
  const f = latest.flight, c = latest.config.flight;
  $("s-min").textContent = won(f.minPrice);
  $("s-airline").textContent = f.cheapest?.[0]?.airline || "";
  $("s-med").textContent = won(f.medianPrice);
  $("s-target").textContent = c.targetPrice ? won(c.targetPrice) : "없음";
  $("s-gap").textContent = c.targetPrice ? (f.minPrice <= c.targetPrice ? "목표가 이하" : `목표까지 ${won(f.minPrice - c.targetPrice)}`) : "";
  if (!latest.hotel) $("s-hotel").textContent = "확인 안 함";
  $("trip").textContent = `${airportLabel(c.origin)} → ${airportLabel(c.destination)} · ${rangeLabel(c.departDate, c.returnDate)} · 성인 ${c.adults}`;
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
  // Hotels without a price (Google didn't quote the stay) sort last.
  const byPrice = (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity);
  const shown = h.list
    .filter((x) => !(exCapsule && x.tag === "capsule") && !(exDorm && x.tag === "dorm"))
    .sort((a, b) => sort === "rating" ? (b.rating ?? 0) - (a.rating ?? 0) || byPrice(a, b) : byPrice(a, b));
  const hidden = h.list.length - shown.length;
  $("hotel-meta").textContent = `${c.query || ""} · ${c.minRating ? `평점 ${Number(c.minRating).toFixed(1)} 이상 · ` : ""}${shown.length}곳${hidden ? ` (${hidden}곳 숨김)` : ""}`;
  const priced = shown.map((x) => x.price).filter((p) => p != null);
  $("s-hotel").textContent = priced.length ? won(Math.min(...priced)) : "-";
  $("s-hotel-hint").textContent = shown.length && !priced.length
    ? "구글이 이 기간 요금을 보여 주지 않음 (보통 30박 초과)" : "아래 숙소 필터 기준";
  $("hotels").innerHTML = shown.map((x) => {
    const q = encodeURIComponent(`${x.name} ${c.checkIn || ""} to ${c.checkOut || ""}`);
    const tag = x.tag ? `<span class="tag lodging ${x.tag}" title="Jev 확신도 ${pct(x.tagConfidence)}">${TAG_LABEL[x.tag] || esc(x.tag)}</span>` : "";
    return `<li class="hotel">
      <div class="hotel-main">
        <a href="https://www.google.com/travel/search?q=${q}&hl=ko&curr=KRW" target="_blank" rel="noopener">${esc(x.name)}</a>
        <span class="hotel-sub">${x.rating != null ? `★ ${x.rating.toFixed(1)}` : "평점 없음"}${x.reviews ? ` (${x.reviews.toLocaleString("ko-KR")})` : ""}${x.stars ? ` · ${x.stars}성급` : ""}${x.deal ? ` · ${esc(x.deal)}` : ""}</span>
      </div>
      <div class="hotel-side">${tag}${x.price != null ? `<b>${won(x.price)}</b>` : `<span class="muted small">요금 미표시</span>`}</div>
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

// =====================================================================
// Editor: airports
// =====================================================================
function searchAirports(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hits = window.AIRPORTS.filter(([code, name, cityKo, cityEn, cc]) =>
    [code, name, cityKo, cityEn, ...(window.COUNTRIES[cc] || [])].join(" ").toLowerCase().includes(q));
  return hits.sort((a, b) => (b[0].toLowerCase() === q) - (a[0].toLowerCase() === q) || b[5] - a[5]);
}

// How often each airport was used, per field: saved watches + picks on this browser.
const frequent = { origin: {}, destination: {} };
function bump(field, code, n = 1) { if (code) frequent[field][code] = (frequent[field][code] || 0) + n; }
function loadFrequent() {
  frequent.origin = {}; frequent.destination = {};
  const local = store.get("airport-picks", { origin: {}, destination: {} });
  for (const f of ["origin", "destination"]) for (const [c, n] of Object.entries(local[f] || {})) bump(f, c, n);
  for (const w of state.watches) { bump("origin", w.config?.flight?.origin, 2); bump("destination", w.config?.flight?.destination, 2); }
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

  const shownValue = () => (state.bulk ? "" : airportLabel(hidden.value));
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const choose = (code) => {
    rememberPick(field, code);
    if (state.bulk) {
      if (!state.multi[field].includes(code)) state.multi[field].push(code);
      input.value = ""; renderChips(field); updateBulkPreview(); open(); return;
    }
    hidden.value = code; input.value = airportLabel(code); close();
  };
  const row = (a, i) => {
    const picked = state.bulk && state.multi[field].includes(a[0]);
    return `<li role="option" id="${field}-opt-${i}" data-code="${a[0]}" class="combo-item${picked ? " picked" : ""}" aria-selected="${picked}">
      <span class="code">${a[0]}</span><span class="name">${esc(a[2])} · ${esc(a[1])}</span><span class="country">${picked ? "✓" : esc(window.COUNTRIES[a[4]]?.[0] || "")}</span></li>`;
  };
  const group = (title, airports, start) =>
    `<li class="combo-group" role="presentation">${esc(title)}</li>` + airports.map((a, j) => row(a, start + j)).join("");
  const open = () => {
    const hits = searchAirports(input.value === shownValue() ? "" : input.value);
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
    } else if (e.key === "Escape") { close(); input.value = shownValue(); }
    else if (e.key === "Backspace" && state.bulk && !input.value && state.multi[field].length) {
      state.multi[field].pop(); renderChips(field); updateBulkPreview();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[role=option]");
    if (li) { e.preventDefault(); choose(li.dataset.code); }
  });
  input.addEventListener("blur", () => { close(); input.value = shownValue(); });
  combos[field] = {
    set: (code) => { hidden.value = code; input.value = shownValue(); },
    get: () => hidden.value,
    refresh: () => { input.value = shownValue(); input.placeholder = state.bulk ? "여러 공항 추가" : (field === "origin" ? "도시·국가·공항 코드" : "예: 일본, 도쿄, NRT"); },
  };
}

// chips for bulk mode: origin / destination / dates
function renderChips(kind) {
  const box = document.querySelector(`[data-chips="${kind}"]`);
  box.hidden = !state.bulk;
  if (!state.bulk) return;
  const items = state.multi[kind];
  box.innerHTML = items.map((v, i) => {
    const label = kind === "dates" ? rangeLabel(v.depart, v.ret) : `${v} ${cityOf(v)}`;
    return `<span class="pill">${esc(label)}<button type="button" data-remove="${kind}:${i}" aria-label="${esc(label)} 빼기">×</button></span>`;
  }).join("") || `<span class="muted small">${kind === "dates" ? "달력에서 범위를 고를 때마다 추가됩니다" : "목록에서 고를 때마다 추가됩니다"}</span>`;
}

// =====================================================================
// Editor: date range picker — first click = 가는 날, next later click = 오는 날
// =====================================================================
const dates = { depart: "", ret: "", picking: "depart", viewMonth: null };
function updateDateButton() {
  const b = $("date-button");
  const f = $("cfg").elements;
  f.departDate.value = dates.depart; f.returnDate.value = dates.ret;
  if (state.bulk) { b.textContent = state.multi.dates.length ? `날짜 범위 ${state.multi.dates.length}개 · 더 추가` : "날짜 범위 추가"; return; }
  b.textContent = dates.depart ? rangeLabel(dates.depart, dates.ret) : "날짜 선택";
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
  if (state.bulk) { dates.depart = ""; dates.ret = ""; }
  const base = dates.depart || state.multi.dates.at(-1)?.depart;
  dates.viewMonth = base ? parseISO(base) : new Date();
  dates.viewMonth.setDate(1);
  renderCalendar();
  $("calendar").hidden = false;
  $("date-button").setAttribute("aria-expanded", "true");
}
function closeCalendar() { $("calendar").hidden = true; $("date-button").setAttribute("aria-expanded", "false"); }

function commitRange() {
  // Bulk mode collects ranges; single mode just keeps the one range.
  if (state.bulk && dates.depart) {
    if (!state.multi.dates.some((r) => r.depart === dates.depart && r.ret === dates.ret)) state.multi.dates.push({ depart: dates.depart, ret: dates.ret });
    renderChips("dates"); updateBulkPreview();
  }
  updateDateButton();
}

function setupCalendar() {
  $("date-button").addEventListener("click", () => ($("calendar").hidden ? openCalendar() : closeCalendar()));
  $("calendar").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { dates.viewMonth.setMonth(dates.viewMonth.getMonth() + Number(nav.dataset.nav)); renderCalendar(); return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "oneway") { dates.ret = ""; commitRange(); closeCalendar(); return; }
    if (act === "done") { closeCalendar(); return; }
    const day = e.target.closest("[data-date]")?.dataset.date;
    if (!day) return;
    if (dates.picking === "depart" || day < dates.depart) {
      dates.depart = day; dates.ret = ""; dates.picking = "return";
      updateDateButton(); renderCalendar();
    } else {
      dates.ret = day; dates.picking = "depart";
      commitRange(); closeCalendar();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!$("calendar").hidden && !e.target.closest(".dates")) closeCalendar();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCalendar(); });
}

// =====================================================================
// Editor: form
// =====================================================================
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

function fillForm(cfg) {
  const f = $("cfg").elements, c = cfg.flight, h = cfg.hotel || {};
  combos.origin.set(c.origin);
  combos.destination.set(c.destination);
  dates.depart = c.departDate; dates.ret = c.returnDate || "";
  f.adults.value = c.adults; f.targetPrice.value = c.targetPrice;
  setSelect(f.minBuy, Math.round((cfg.alert?.minBuyProbability ?? 0.7) * 100));
  f.hotelEnabled.checked = !!h.enabled; f.hotelQuery.value = h.query || "";
  setSelect(f.minRating, Number(h.minRating) || 0);
  syncHotelFields();
  updateDateButton();
}

// Shared fields (everything except route and dates).
function sharedConfig() {
  const f = $("cfg").elements;
  return {
    adults: Number(f.adults.value), targetPrice: Number(f.targetPrice.value),
    hotel: { enabled: f.hotelEnabled.checked, query: f.hotelQuery.value.trim(), minRating: Number(f.minRating.value) },
    alert: { minBuyProbability: Number(f.minBuy.value) / 100 },
  };
}

function makeConfig(origin, destination, depart, ret, shared) {
  return {
    flight: { origin, destination, departDate: depart, returnDate: ret || "", adults: shared.adults, currency: "KRW", targetPrice: shared.targetPrice },
    hotel: { ...shared.hotel, checkIn: depart, checkOut: ret || "" },
    alert: shared.alert,
  };
}

// Every config the editor currently describes (one in single mode, the combinations in bulk mode).
function buildConfigs() {
  const shared = sharedConfig();
  if (!state.bulk) {
    const f = $("cfg").elements;
    return [makeConfig(f.origin.value, f.destination.value, f.departDate.value, f.returnDate.value, shared)];
  }
  const out = [];
  for (const o of state.multi.origin) for (const d of state.multi.destination) for (const r of state.multi.dates) {
    if (o !== d) out.push(makeConfig(o, d, r.depart, r.ret, shared));
  }
  return out;
}

function updateBulkPreview() {
  const box = $("bulk-preview");
  box.hidden = !state.bulk;
  if (!state.bulk) return;
  const m = state.multi;
  const configs = buildConfigs();
  const missing = [!m.origin.length && "출발", !m.destination.length && "도착", !m.dates.length && "날짜"].filter(Boolean);
  if (missing.length) { box.innerHTML = `<b>여러 개 한 번에</b> · ${missing.join(", ")}을(를) 하나 이상 고르세요. 나머지 조건은 모든 감시에 똑같이 들어갑니다.`; return; }
  const over = configs.length > MAX_BULK;
  box.innerHTML = `<b>${m.origin.length} × ${m.destination.length} × ${m.dates.length} = ${configs.length}개</b> 감시가 만들어집니다${over ? ` <span class="warn">(최대 ${MAX_BULK}개)</span>` : ""}
    <ul>${configs.slice(0, 8).map((c) => `<li>${esc(watchTitle(c))} · ${esc(watchDates(c))}</li>`).join("")}${configs.length > 8 ? `<li class="muted">외 ${configs.length - 8}개</li>` : ""}</ul>`;
}

function setBulk(on) {
  state.bulk = on;
  $("bulk-toggle").checked = on;
  $("editor").classList.toggle("bulk", on);
  if (on) {
    // Start the lists from what is in the single fields.
    const f = $("cfg").elements;
    state.multi.origin = f.origin.value ? [f.origin.value] : [];
    state.multi.destination = f.destination.value ? [f.destination.value] : [];
    state.multi.dates = dates.depart ? [{ depart: dates.depart, ret: dates.ret }] : [];
  }
  for (const k of ["origin", "destination", "dates"]) renderChips(k);
  combos.origin.refresh(); combos.destination.refresh();
  $("swap").hidden = on;
  updateDateButton();
  updateBulkPreview();
  updateEditorHead();
}

function updateEditorHead() {
  const editing = state.editingId != null && !state.bulk;
  const w = editing ? findWatch(state.editingId) : null;
  $("editor-title").textContent = editing ? "감시 편집" : state.bulk ? "여러 감시 한 번에 추가" : "새 감시";
  $("editor-sub").textContent = editing && w ? `${watchTitle(w.config)} · ${watchDates(w.config)}`
    : state.bulk ? "출발·도착·날짜를 여러 개 고르면 조합마다 감시가 생깁니다. 나머지 조건은 똑같이 들어갑니다."
    : "조건을 정하고 추가하면 바로 검색합니다.";
  $("run-btn").textContent = editing ? "저장하고 검색" : "추가하고 검색";
  $("new-watch").hidden = !editing;
  $("editor").classList.toggle("editing", editing);
}

function editWatch(w) {
  if (state.bulk) setBulk(false);
  state.editingId = w.id;
  fillForm(w.config);
  updateEditorHead();
  $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyWatch(w) {
  if (state.bulk) setBulk(false);
  state.editingId = null;
  fillForm(w.config);
  updateEditorHead();
  $("form-msg").textContent = "복제했습니다. 바꿀 조건만 고친 뒤 추가하세요.";
  $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function startNew() {
  state.editingId = null;
  updateEditorHead();
  $("form-msg").textContent = "";
}

function validate(configs) {
  if (!configs.length) return state.bulk ? "출발·도착·날짜를 하나 이상씩 고르세요." : "조건을 확인하세요.";
  if (configs.length > MAX_BULK) return `한 번에 최대 ${MAX_BULK}개까지 만들 수 있습니다.`;
  for (const c of configs) {
    const f = c.flight;
    if (!f.origin || !f.destination) return "출발·도착 공항을 목록에서 골라 주세요.";
    if (f.origin === f.destination) return "출발과 도착 공항이 같습니다.";
    if (!f.departDate) return "날짜를 골라 주세요.";
  }
  return null;
}

async function saveEditor(runAfter) {
  const configs = buildConfigs();
  const msg = $("form-msg");
  const problem = validate(configs);
  if (problem) { msg.textContent = problem; return; }
  msg.textContent = "저장 중…";
  const stamp = new Date().toISOString();
  let ids, skipped = 0;
  if (state.editingId != null && !state.bulk) {
    const { error } = await sb.from("watches").update({ config: configs[0], updated_at: stamp, last_error: null }).eq("id", state.editingId);
    if (error) { msg.textContent = `저장하지 못했습니다: ${error.message}`; return; }
    ids = [state.editingId];
  } else {
    // Skip combinations that already exist as a watch with the same flight conditions.
    const existing = new Set(state.watches.map((w) => JSON.stringify(w.config.flight)));
    const fresh = configs.filter((c) => !existing.has(JSON.stringify(c.flight)));
    skipped = configs.length - fresh.length;
    if (!fresh.length) { msg.textContent = "이미 같은 조건의 감시가 있습니다. 목록에서 ↻ 로 검색하세요."; return; }
    const { data, error } = await sb.from("watches").insert(fresh.map((config) => ({ watcher: WATCHER, config }))).select("id");
    if (error) { msg.textContent = `추가하지 못했습니다: ${error.message}`; return; }
    ids = data.map((r) => r.id);
  }
  await loadWatches();
  loadFrequent();
  if (ids.length === 1) selectWatch(ids[0]);
  if (state.bulk) setBulk(false);
  startNew();
  msg.textContent = (ids.length > 1 ? `${ids.length}개 저장했습니다.` : "저장했습니다.") + (skipped ? ` 이미 있는 ${skipped}개는 건너뛰었습니다.` : "");
  if (runAfter) await requestRuns(ids);
}

function setupEditor() {
  setupCombo("origin");
  setupCombo("destination");
  setupCalendar();
  $("swap").addEventListener("click", () => {
    const o = combos.origin.get(), d = combos.destination.get();
    combos.origin.set(d); combos.destination.set(o);
  });
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
  $("bulk-toggle").addEventListener("change", (e) => { if (e.target.checked) state.editingId = null; setBulk(e.target.checked); });
  $("new-watch").addEventListener("click", startNew);
  $("editor").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]")?.dataset.remove;
    if (!rm) return;
    const [kind, i] = rm.split(":");
    state.multi[kind].splice(Number(i), 1);
    renderChips(kind); updateBulkPreview(); updateDateButton();
  });
  $("save-only").addEventListener("click", () => saveEditor(false));
  $("cfg").addEventListener("submit", (e) => { e.preventDefault(); saveEditor(true); });
}

// =====================================================================
// Start
// =====================================================================
function subscribeLive() {
  sb.channel("watches-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "watches" }, async (p) => {
      await loadWatches();
      if (p.new?.id === state.selectedId && p.new?.last_checked_at !== p.old?.last_checked_at) await showDetail();
    })
    .subscribe();
}

(async () => {
  try { await window.wwa.requireLogin(document.querySelector("main")); } catch { return; }
  sb = window.wwa.sb;
  $("logout").hidden = false;
  $("logout").addEventListener("click", window.wwa.logout);
  window.wwa.watchAgent();
  setupEditor();
  setupWatchList();
  setupHotelFilters();
  try {
    await loadWatches();
    loadFrequent();
    // Editor starts as a copy of the most recent watch, so a new search only needs the changes.
    const recent = state.watches.at(-1);
    fillForm(recent?.config ?? {
      flight: { origin: "ICN", destination: "", departDate: "", returnDate: "", adults: 1, targetPrice: 0 },
      hotel: { enabled: false, query: "", minRating: 0 }, alert: { minBuyProbability: 0.7 },
    });
    updateEditorHead();
    const saved = store.get("selected-watch", null);
    state.selectedId = findWatch(saved) ? saved : recent?.id ?? null;
    renderWatchList();
    await showDetail();
    await resumePendingRequests();
    subscribeLive();
  } catch (e) {
    $("watch-rows").innerHTML = `<tr><td colspan="7" class="muted">데이터를 불러오지 못했습니다: ${esc(e.message)}</td></tr>`;
    console.error(e);
  }
})();
