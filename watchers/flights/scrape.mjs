// Runs inside `ego-browser nodejs` (not plain node). Read-only: it opens Google Flights /
// Google Hotels, reads prices, and writes watchers/flights/.tmp/scrape.json. It never clicks booking or pay buttons.
// core/agent.ts writes the current config to .tmp/config.json before starting this script.
const fs = await import("node:fs/promises");
const { fileURLToPath } = await import("node:url");
const path = await import("node:path");

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(here, ".tmp", "config.json"), "utf8"));
const f = config.flight;

const task = await taskSpace("web-watch-agent flights");
const page = task.page("p1");

async function load(url) {
  await page.goto(url);
  await page.waitForLoadState();
  await page.waitForFunction(() => /₩[\d,]+/.test(document.body.innerText), undefined, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.body.innerText);
}
const num = (s) => Number(s.replace(/[^\d]/g, ""));
const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

// ---- flights ----
const adults = Number(f.adults) > 1 ? ` for ${f.adults} adults` : "";
const trip = f.returnDate
  ? `Flights to ${f.destination} from ${f.origin} on ${f.departDate} through ${f.returnDate}${adults}`
  : `One way flights to ${f.destination} from ${f.origin} on ${f.departDate}${adults}`;
const flightUrl = "https://www.google.com/travel/flights?q=" + encodeURIComponent(trip) + `&curr=${f.currency}&hl=ko`;
const fl = lines(await load(flightUrl));

const flights = [];
for (let i = 0; i < fl.length; i++) {
  if (!/^₩[\d,]+$/.test(fl[i])) continue;
  let airline = "";
  for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
    if (/^\d+시간/.test(fl[j])) { airline = fl[j - 1] || ""; break; }
  }
  flights.push({ airline, price: num(fl[i]) });
}
const sorted = flights.map((x) => x.price).sort((a, b) => a - b);
const flight = {
  url: flightUrl,
  count: flights.length,
  minPrice: sorted[0] ?? null,
  medianPrice: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  cheapest: flights.slice().sort((a, b) => a.price - b.price).slice(0, 3),
  googleInsight: fl.find((l) => /가격이 현재|평소보다/.test(l)) || "",
};

// ---- hotels (optional) ----
let hotel = null;
if (config.hotel?.enabled) {
  const h = config.hotel;
  const hotelUrl =
    "https://www.google.com/travel/search?q=" +
    encodeURIComponent(`${h.query} ${h.checkIn} to ${h.checkOut}`) +
    `&curr=${f.currency}&hl=ko`;
  let text = await load(hotelUrl);

  // Apply Google's own guest-rating filter (3.5 / 4.0 / 4.5+) before reading results.
  const minRating = Number(h.minRating) || 0;
  let ratingFilterApplied = false;
  if (minRating >= 3.5) {
    try {
      const before = text;
      await page.click("loc=role:button[name='고객 평점, 선택되지 않음']", { label: "open guest rating filter" });
      await page.click(`input[aria-label='투숙객 평점 ${minRating.toFixed(1)} 이상']`, { label: "pick minimum guest rating" });
      await page.waitForFunction((b) => document.body.innerText !== b, before, { timeout: 15000 });
      await page.waitForTimeout(2000);
      await page.press("body", "Escape");
      text = await page.evaluate(() => document.body.innerText);
      ratingFilterApplied = true;
    } catch (e) {
      console.log(`rating filter not applied (${e.message.split("\n")[0]}); judge.ts filters by rating instead`);
    }
  }

  // Each result card reads: name, [deal label], ₩price, rating, (reviews), ..., "N성급 호텔", amenities, "가격 보기".
  const hl = lines(text);
  const deal = /^(파격 할인가|할인 상품|특가|합리적인 가격|최저가|인기.*|.*% 할인)$/;
  const list = [];
  for (let i = 0; i < hl.length; i++) {
    if (!/^₩[\d,]+$/.test(hl[i])) continue;
    let n = i - 1;
    while (n >= 0 && deal.test(hl[n])) n--;
    const name = hl[n];
    if (!name || /필터|평균 가격|검색결과/.test(name)) continue;
    // A card ends at "가격 보기" or, when that button is missing, at the next card's price.
    let end = i + 1;
    while (end < hl.length && end < i + 25 && hl[end] !== "가격 보기" && !/^₩[\d,]+$/.test(hl[end])) end++;
    const body = hl.slice(i + 1, end);
    const rating = /^\d\.\d$/.test(body[0]) ? Number(body[0]) : null;
    const reviews = /^\(\d[\d,]*\)$/.test(body[1] || "") ? num(body[1]) : null;
    const starLine = body.find((l) => /^\d성급 호텔$/.test(l));
    const amenities = body.filter((l) => l.length < 20 && !/^[\d(.·]/.test(l) && l !== starLine && !deal.test(l));
    list.push({
      name, price: num(hl[i]), rating, reviews,
      stars: starLine ? Number(starLine[0]) : null,
      deal: deal.test(hl[i - 1]) ? hl[i - 1] : null,
      amenities: amenities.slice(0, 6),
    });
  }
  const seen = new Set();
  const unique = list.filter((x) => !seen.has(x.name) && seen.add(x.name));
  const prices = unique.map((x) => x.price).sort((a, b) => a - b);
  hotel = {
    url: hotelUrl,
    minRating,
    ratingFilterApplied,
    count: unique.length,
    minPricePerNight: prices[0] ?? null,
    medianPricePerNight: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    list: unique,
  };
}

const out = { checkedAt: new Date().toISOString(), flight, hotel };
await fs.mkdir(path.join(here, ".tmp"), { recursive: true });
await fs.writeFile(path.join(here, ".tmp", "scrape.json"), JSON.stringify(out, null, 2), "utf8");
console.log(`scraped: flights=${flight.count} min=${flight.minPrice} hotel=${hotel?.minPricePerNight ?? "-"}`);
await task.finish({ keep: [] });
