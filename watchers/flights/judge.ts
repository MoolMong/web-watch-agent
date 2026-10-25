// Reads watchers/flights/.tmp/scrape.json, asks Jev whether to buy now, and writes the dashboard data
// (docs/flights/data/latest.json, history.json). Never books or pays.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { decide } from "../../core/jev.ts";

const root = new URL("../../", import.meta.url);
const read = async (p: string) => JSON.parse(await readFile(new URL(p, root), "utf8"));
const write = (p: string, v: unknown) => writeFile(new URL(p, root), JSON.stringify(v, null, 2) + "\n", "utf8");

const config = await read("docs/flights/config.json");
const scrape = await read("watchers/flights/.tmp/scrape.json");
const configKey = JSON.stringify(config.flight);

type Entry = {
  checkedAt: string; configKey: string; minPrice: number; medianPrice: number | null;
  hotelMinPerNight: number | null; isCheap: number; buyProbability: number; alert: boolean;
};
let history: Entry[] = [];
try { history = await read("docs/flights/data/history.json"); } catch {}

const f = scrape.flight;
if (f.minPrice == null) {
  console.error("항공권 가격을 읽지 못했습니다:", f.url);
  process.exit(1);
}

// Only compare against checks made with the same trip conditions.
const prior = history.filter((h) => h.configKey === configKey).map((h) => h.minPrice).sort((a, b) => a - b);
const state = {
  route: `${config.flight.origin}->${config.flight.destination}`,
  depart: config.flight.departDate,
  return: config.flight.returnDate || null,
  adults: config.flight.adults,
  currency: config.flight.currency,
  current_min_price: f.minPrice,
  median_price_today: f.medianPrice,
  user_target_price: config.flight.targetPrice || null,
  google_insight: f.googleInsight || null,
  days_until_departure: Math.round((Date.parse(config.flight.departDate) - Date.now()) / 86_400_000),
  my_history: { checks: prior.length, lowest_seen: prior[0] ?? null, highest_seen: prior.at(-1) ?? null },
};

const res = await decide(state, {
  is_cheap: {
    type: "noul",
    instructions: "Is the current minimum fare cheap compared with the price context given?",
    criteria: {
      true: "Price is at or below the user's target, or Google says it is lower than usual, or it is near the lowest seen.",
      false: "Price is above the target and not lower than usual.",
    },
  },
  action: {
    type: "choice",
    instructions: "Should the traveler buy this fare now or keep waiting?",
    criteria: {
      buy: "Fare is a good deal now; waiting risks a higher price.",
      wait: "Fare is not a good deal; keep monitoring.",
    },
  },
});

const cheap = res.answers.is_cheap;
const act = res.answers.action;
const isCheap = cheap.type === "noul" ? cheap.noul : 0;
const buyProbability = act.type === "choice" ? (act.probabilities.buy ?? 0) : 0;
const hitTarget = config.flight.targetPrice > 0 && f.minPrice <= config.flight.targetPrice;
const alert = hitTarget || buyProbability >= config.alert.minBuyProbability;

const latest = {
  ...scrape,
  config,
  verdict: { model: res.model, isCheap, buyProbability, hitTarget, alert, cost: res.usage.cost },
};
history.push({
  checkedAt: scrape.checkedAt, configKey, minPrice: f.minPrice, medianPrice: f.medianPrice,
  hotelMinPerNight: scrape.hotel?.minPricePerNight ?? null, isCheap, buyProbability, alert,
});

await mkdir(new URL("docs/flights/data/", root), { recursive: true });
await write("docs/flights/data/latest.json", latest);
await write("docs/flights/data/history.json", history.slice(-1000));

const won = (n: number | null) => (n == null ? "-" : `₩${n.toLocaleString("ko-KR")}`);
console.log(`${state.route} 최저 ${won(f.minPrice)} / 저렴 ${(isCheap * 100).toFixed(0)}% / 구매 ${(buyProbability * 100).toFixed(0)}%${alert ? "  >>> 구매 시점" : ""}`);
