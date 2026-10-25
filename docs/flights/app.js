const $ = (id) => document.getElementById(id);
const won = (n) => (n == null ? "-" : "₩" + Number(n).toLocaleString("ko-KR"));
const pct = (p) => (p == null ? "-" : Math.round(p * 100) + "%");
const when = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function getJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ---- airports ----
const AIRPORT_BY_CODE = Object.fromEntries(window.AIRPORTS.map((a) => [a[0], a]));
const COUNTRY_ORDER = Object.keys(window.COUNTRIES);
function airportLabel(code) {
  const a = AIRPORT_BY_CODE[code];
  return a ? `${a[2]} ${a[1]} (${a[0]})` : code;
}

function renderVerdict(latest) {
  const v = latest.verdict;
  const el = $("verdict");
  el.className = "card verdict " + (v.alert ? "buy" : "wait");
  const links = [`<a class="button" href="${esc(latest.flight.url)}" target="_blank" rel="noopener">구글 항공권에서 보기</a>`];
  if (latest.hotel) links.push(`<a class="button ghost" href="${esc(latest.hotel.url)}" target="_blank" rel="noopener">호텔 보기</a>`);
  const threshold = Math.round((latest.config.alert?.minBuyProbability ?? 0.7) * 100);
  el.innerHTML = `
    <div class="badge">${v.alert ? "지금 구매 추천" : "기다리세요"}</div>
    <div class="body">
      <p>Jev 판단: 저렴함 <b>${pct(v.isCheap)}</b> · 지금 구매 <b>${pct(v.buyProbability)}</b> <span class="muted">(알림 기준 ${threshold}%)</span>${v.hitTarget ? " · <b>목표가 도달</b>" : ""}</p>
      <p class="muted">${v.alert ? "링크에서 직접 확인하고 결제하세요. 자동 결제는 하지 않습니다." : "구매 확률이 알림 기준을 넘거나 목표가에 닿으면 이 화면이 바뀝니다."}</p>
    </div>
    <div class="actions">${links.join("")}</div>`;
}

function renderStats(latest) {
  const f = latest.flight, c = latest.config.flight;
  $("s-min").textContent = won(f.minPrice);
  $("s-airline").textContent = f.cheapest?.[0]?.airline || "";
  $("s-med").textContent = won(f.medianPrice);
  $("s-target").textContent = c.targetPrice ? won(c.targetPrice) : "없음";
  if (c.targetPrice) {
    const gap = f.minPrice - c.targetPrice;
    $("s-gap").textContent = gap <= 0 ? "목표가 이하" : `목표까지 ${won(gap)}`;
  }
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

function renderHotels(latest) {
  const h = latest.hotel;
  if (!h?.list) return;
  $("hotel-card").hidden = false;
  const c = latest.config.hotel || {};
  const exCapsule = $("ex-capsule"), exDorm = $("ex-dorm"), sort = $("hotel-sort");
  exCapsule.checked = store.get("ex-capsule", false);
  exDorm.checked = store.get("ex-dorm", false);
  sort.value = store.get("hotel-sort", "price");

  const draw = () => {
    store.set("ex-capsule", exCapsule.checked);
    store.set("ex-dorm", exDorm.checked);
    store.set("hotel-sort", sort.value);
    const shown = h.list
      .filter((x) => !(exCapsule.checked && x.tag === "capsule") && !(exDorm.checked && x.tag === "dorm"))
      .sort((a, b) => sort.value === "rating" ? (b.rating ?? 0) - (a.rating ?? 0) || a.price - b.price : a.price - b.price);
    const hidden = h.list.length - shown.length;
    $("hotel-meta").textContent = `${esc(c.query || "")} · ${c.minRating ? `평점 ${Number(c.minRating).toFixed(1)} 이상 · ` : ""}${shown.length}곳${hidden ? ` (${hidden}곳 숨김)` : ""}`;
    $("s-hotel").textContent = shown.length ? won(Math.min(...shown.map((x) => x.price))) : "-";
    $("hotels").innerHTML = shown.map((x) => {
      const q = encodeURIComponent(`${x.name} ${c.checkIn || ""} to ${c.checkOut || ""}`);
      const tag = x.tag ? `<span class="tag lodging ${x.tag}" title="Jev 확신도 ${pct(x.tagConfidence)}">${TAG_LABEL[x.tag] || x.tag}</span>` : "";
      return `<li class="hotel">
        <div class="hotel-main">
          <a href="https://www.google.com/travel/search?q=${q}&hl=ko&curr=KRW" target="_blank" rel="noopener">${esc(x.name)}</a>
          <span class="hotel-sub">${x.rating != null ? `★ ${x.rating.toFixed(1)}` : "평점 없음"}${x.reviews ? ` (${x.reviews.toLocaleString("ko-KR")})` : ""}${x.stars ? ` · ${x.stars}성급` : ""}${x.deal ? ` · ${esc(x.deal)}` : ""}</span>
        </div>
        <div class="hotel-side">${tag}<b>${won(x.price)}</b></div>
      </li>`;
    }).join("") || `<li class="muted">조건에 맞는 숙소가 없습니다.</li>`;
  };
  [exCapsule, exDorm, sort].forEach((el) => el.addEventListener("change", draw));
  draw();
}

// ---- airport combobox ----
function searchAirports(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hits = window.AIRPORTS.filter(([code, name, cityKo, cityEn, cc]) => {
    const country = window.COUNTRIES[cc] || [];
    return [code, name, cityKo, cityEn, ...country].join(" ").toLowerCase().includes(q);
  });
  return hits.sort((a, b) => (b[0].toLowerCase() === q) - (a[0].toLowerCase() === q) || b[5] - a[5]);
}

function setupCombo(field, initial) {
  const box = document.querySelector(`.combo[data-field="${field}"]`);
  const input = box.querySelector("[role=combobox]");
  const hidden = box.querySelector("input[type=hidden]");
  const list = box.querySelector("[role=listbox]");
  let items = [], active = -1;

  const choose = (code) => {
    hidden.value = code;
    input.value = airportLabel(code);
    close();
    updatePreview();
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const row = (a, i) => `<li role="option" id="${field}-opt-${i}" data-code="${a[0]}" class="combo-item">
      <span class="code">${a[0]}</span><span class="name">${esc(a[2])} · ${esc(a[1])}</span><span class="country">${esc(window.COUNTRIES[a[4]]?.[0] || "")}</span></li>`;
  const open = () => {
    const hits = searchAirports(input.value === airportLabel(hidden.value) ? "" : input.value);
    let html;
    if (hits) {
      items = hits.slice(0, 40);
      html = items.map(row).join("") || `<li class="combo-empty">결과 없음. 공항 코드(예: NRT)로도 찾을 수 있습니다.</li>`;
    } else {
      // No query: every country in order, airports by size within it.
      items = [];
      html = COUNTRY_ORDER.map((cc) => {
        const group = window.AIRPORTS.filter((a) => a[4] === cc).sort((a, b) => b[5] - a[5]);
        if (!group.length) return "";
        const start = items.length;
        items.push(...group);
        return `<li class="combo-group" role="presentation">${esc(window.COUNTRIES[cc][0])}</li>` + group.map((a, j) => row(a, start + j)).join("");
      }).join("");
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

  hidden.value = initial;
  input.value = airportLabel(initial);
}

// ---- config form ----
function repoInfo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

function setSelect(select, value) {
  const v = String(value);
  if (![...select.options].some((o) => o.value === v)) select.add(new Option(`${v}`, v));
  select.value = v;
}

function fillForm(cfg) {
  const f = $("cfg").elements, c = cfg.flight, h = cfg.hotel || {};
  setupCombo("origin", c.origin);
  setupCombo("destination", c.destination);
  f.departDate.value = c.departDate; f.returnDate.value = c.returnDate || "";
  f.adults.value = c.adults; f.targetPrice.value = c.targetPrice;
  setSelect(f.minBuy, Math.round((cfg.alert?.minBuyProbability ?? 0.7) * 100));
  f.hotelEnabled.checked = !!h.enabled; f.hotelQuery.value = h.query || "";
  setSelect(f.minRating, Number(h.minRating) || 0);
}

function buildConfig() {
  const f = $("cfg").elements;
  const flight = {
    origin: f.origin.value,
    destination: f.destination.value,
    departDate: f.departDate.value,
    returnDate: f.returnDate.value,
    adults: Number(f.adults.value),
    currency: "KRW",
    targetPrice: Number(f.targetPrice.value),
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

function updatePreview() { $("preview").textContent = JSON.stringify(buildConfig(), null, 2); }

function setupForm(cfg) {
  fillForm(cfg);
  updatePreview();
  $("cfg").addEventListener("input", updatePreview);
  $("cfg").addEventListener("change", updatePreview);
  const info = repoInfo();
  if (!info) { $("run-btn").disabled = true; $("run-btn").title = "GitHub Pages에서 열면 동작합니다"; }

  // "지금 검색": open a prefilled GitHub issue; the PC's poll task applies it and runs a check.
  $("cfg").addEventListener("submit", (e) => {
    e.preventDefault();
    const cfg = buildConfig();
    if (!cfg.flight.origin || !cfg.flight.destination) { $("copied").textContent = "출발·도착 공항을 목록에서 골라 주세요."; return; }
    if (cfg.flight.returnDate && cfg.flight.returnDate < cfg.flight.departDate) { $("copied").textContent = "오는 날이 가는 날보다 빠릅니다."; return; }
    const c = cfg.flight;
    const title = `[run] flights ${c.origin}→${c.destination} ${c.departDate}${c.returnDate ? "~" + c.returnDate : ""}`;
    const body = "대시보드에서 보낸 검색 요청입니다. **Submit new issue**를 누르면 PC가 이 조건을 저장하고 바로 검색합니다.\n\n```json\n"
      + JSON.stringify(cfg, null, 2) + "\n```\n";
    const url = `https://github.com/${info.owner}/${info.repo}/issues/new?labels=run&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    store.set("run-requested-at", Date.now());
    $("copied").textContent = "GitHub 창에서 Submit new issue를 눌러 주세요.";
    watchRunStatus(info);
  });
  $("copy-btn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(buildConfig(), null, 2) + "\n"); $("copied").textContent = "설정을 복사했습니다."; }
    catch { $("copied").textContent = "복사 권한이 없습니다. '설정 JSON 보기'에서 직접 복사하세요."; }
  });
  if (info) watchRunStatus(info);
}

// Shows the newest search request and its state; while one is pending, re-check every 20 s
// and reload the dashboard once the PC closes it.
let statusTimer = null;
async function watchRunStatus(info) {
  clearTimeout(statusTimer);
  const el = $("run-status");
  let issue;
  try {
    const res = await fetch(`https://api.github.com/repos/${info.owner}/${info.repo}/issues?labels=run&state=all&per_page=1&sort=created`);
    if (!res.ok) return;
    [issue] = await res.json();
  } catch { return; }
  const requestedAt = store.get("run-requested-at", 0);
  const waiting = Date.now() - requestedAt < 10 * 60_000;
  if (!issue && !waiting) return;
  el.hidden = false;
  const link = issue ? `<a href="${esc(issue.html_url)}" target="_blank" rel="noopener">#${issue.number}</a>` : "";
  if (issue?.state === "open") {
    el.className = "run-status pending";
    el.innerHTML = `⏳ 검색 요청 ${link} 처리 중입니다. PC가 켜져 있으면 2분 안에 시작하고, 검색은 1~2분 걸립니다.`;
  } else if (waiting && (!issue || Date.parse(issue.created_at) < requestedAt - 60_000)) {
    el.className = "run-status pending";
    el.innerHTML = `GitHub 창에서 <b>Submit new issue</b>를 누르면 여기에 진행 상황이 표시됩니다.`;
  } else {
    el.className = "run-status done";
    el.innerHTML = `✅ 최근 검색 요청 ${link} 처리 완료 (${when(issue.closed_at || issue.updated_at)})`;
    if (store.get("run-reloaded-for", 0) !== issue.number && waiting) {
      // GitHub Pages needs about a minute to publish the pushed results.
      store.set("run-reloaded-for", issue.number);
      el.innerHTML += " · 결과를 반영하는 중이라 1분 뒤 새로고침합니다.";
      setTimeout(() => location.reload(), 60_000);
    }
    return;
  }
  if (Date.now() - requestedAt < 30 * 60_000) statusTimer = setTimeout(() => watchRunStatus(info), 20_000);
}

(async () => {
  let cfg;
  try { cfg = await getJSON("config.json"); setupForm(cfg); } catch (e) { console.error(e); }
  try {
    const [latest, history] = await Promise.all([getJSON("data/latest.json"), getJSON("data/history.json").catch(() => [])]);
    const key = JSON.stringify((cfg || latest.config).flight);
    const points = history.filter((h) => h.configKey === key);
    renderVerdict(latest);
    renderStats(latest);
    renderChart(points, latest.config.flight.targetPrice);
    renderRows(points);
    renderHotels(latest);
    if (cfg && JSON.stringify(latest.config.flight) !== key) {
      $("insight").textContent = "조건이 바뀌었습니다. 다음 확인부터 새 조건으로 기록됩니다.";
    }
  } catch (e) {
    $("verdict").innerHTML = `<p class="muted">아직 확인 결과가 없습니다. PC에서 watcher를 한 번 실행하면 나타납니다.</p>`;
    console.error(e);
  }
})();
