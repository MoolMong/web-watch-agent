// Runs inside `ego-browser nodejs` (not plain node). Read-only: it opens Google Flights /
// Google Hotels, reads prices, and writes watchers/flights/.tmp/scrape.json. It never clicks booking or pay buttons.
const fs = await import("node:fs/promises");
const { fileURLToPath } = await import("node:url");
const path = await import("node:path");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const config = JSON.parse(await fs.readFile(path.join(root, "docs", "flights", "config.json"), "utf8"));
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
  const prices = [...new Set(lines(await load(hotelUrl)).filter((l) => /^₩[\d,]+$/.test(l)).map(num))].sort((a, b) => a - b);
  hotel = {
    url: hotelUrl,
    count: prices.length,
    minPricePerNight: prices[0] ?? null,
    medianPricePerNight: prices.length ? prices[Math.floor(prices.length / 2)] : null,
  };
}

const out = { checkedAt: new Date().toISOString(), flight, hotel };
await fs.mkdir(path.join(here, ".tmp"), { recursive: true });
await fs.writeFile(path.join(here, ".tmp", "scrape.json"), JSON.stringify(out, null, 2), "utf8");
console.log(`scraped: flights=${flight.count} min=${flight.minPrice} hotel=${hotel?.minPricePerNight ?? "-"}`);
await task.finish({ keep: [] });
