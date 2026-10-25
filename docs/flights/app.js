const $ = (id) => document.getElementById(id);
const won = (n) => (n == null ? "-" : "₩" + Number(n).toLocaleString("ko-KR"));
const pct = (p) => (p == null ? "-" : Math.round(p * 100) + "%");
const when = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function getJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function renderVerdict(latest) {
  const v = latest.verdict;
  const el = $("verdict");
  el.className = "card verdict " + (v.alert ? "buy" : "wait");
  const links = [`<a class="button" href="${latest.flight.url}" target="_blank" rel="noopener">구글 항공권에서 보기</a>`];
  if (latest.hotel) links.push(`<a class="button ghost" href="${latest.hotel.url}" target="_blank" rel="noopener">호텔 보기</a>`);
  el.innerHTML = `
    <div class="badge">${v.alert ? "지금 구매 추천" : "기다리세요"}</div>
    <div class="body">
      <p>Jev 판단: 저렴함 <b>${pct(v.isCheap)}</b> · 지금 구매 <b>${pct(v.buyProbability)}</b>${v.hitTarget ? " · <b>목표가 도달</b>" : ""}</p>
      <p class="muted">${v.alert ? "링크에서 직접 확인하고 결제하세요. 자동 결제는 하지 않습니다." : "가격이 더 내려가면 이 화면이 바뀝니다."}</p>
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
  $("s-hotel").textContent = latest.hotel ? won(latest.hotel.minPricePerNight) : "확인 안 함";
  $("trip").textContent = `${c.origin} → ${c.destination} · ${c.departDate}${c.returnDate ? " ~ " + c.returnDate : " 편도"} · 성인 ${c.adults}`;
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

// ---- config form ----
function repoInfo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

function fillForm(cfg) {
  const f = $("cfg").elements, c = cfg.flight, h = cfg.hotel || {};
  f.origin.value = c.origin; f.destination.value = c.destination;
  f.departDate.value = c.departDate; f.returnDate.value = c.returnDate || "";
  f.adults.value = c.adults; f.targetPrice.value = c.targetPrice;
  f.minBuy.value = Math.round((cfg.alert?.minBuyProbability ?? 0.7) * 100);
  f.hotelEnabled.checked = !!h.enabled; f.hotelQuery.value = h.query || "";
}

function buildConfig() {
  const f = $("cfg").elements;
  const flight = {
    origin: f.origin.value.trim().toUpperCase(),
    destination: f.destination.value.trim().toUpperCase(),
    departDate: f.departDate.value,
    returnDate: f.returnDate.value,
    adults: Number(f.adults.value),
    currency: "KRW",
    targetPrice: Number(f.targetPrice.value),
  };
  return {
    flight,
    hotel: { enabled: f.hotelEnabled.checked, query: f.hotelQuery.value.trim(), checkIn: flight.departDate, checkOut: flight.returnDate },
    alert: { minBuyProbability: Number(f.minBuy.value) / 100 },
  };
}

function updatePreview() { $("preview").textContent = JSON.stringify(buildConfig(), null, 2); }

function setupForm(cfg) {
  fillForm(cfg);
  updatePreview();
  $("cfg").addEventListener("input", updatePreview);
  const info = repoInfo();
  const link = $("edit-link");
  if (info) link.href = `https://github.com/${info.owner}/${info.repo}/edit/main/docs/flights/config.json`;
  else { link.removeAttribute("href"); link.title = "GitHub Pages에서 열면 동작합니다"; }
  $("cfg").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = JSON.stringify(buildConfig(), null, 2) + "\n";
    try { await navigator.clipboard.writeText(text); $("copied").textContent = "복사됨. GitHub에서 전체 선택 후 붙여넣고 Commit 하세요."; }
    catch { $("copied").textContent = "복사 권한이 없습니다. 아래 내용을 직접 복사하세요."; }
  });
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
    if (cfg && JSON.stringify(latest.config.flight) !== key) {
      $("insight").textContent = "조건이 바뀌었습니다. 다음 확인부터 새 조건으로 기록됩니다.";
    }
  } catch (e) {
    $("verdict").innerHTML = `<p class="muted">아직 확인 결과가 없습니다. PC에서 watcher를 한 번 실행하면 나타납니다.</p>`;
    console.error(e);
  }
})();
