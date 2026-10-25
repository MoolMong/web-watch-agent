// Turns one scrape (see scrape.mjs) into a check: asks Jev whether to buy the fare now and
// tags hotels as capsule / dorm / private. Never books or pays.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decide } from "../../core/jev.ts";
import { tagHotels, type TagCache } from "./hotel-tags.ts";
import type { FlightsConfig } from "./config.ts";

const tagFile = new URL("./.tmp/hotel-tags.json", import.meta.url);

export type Summary = {
  minPrice: number; medianPrice: number | null; hotelMinPerNight: number | null;
  isCheap: number; buyProbability: number; alert: boolean;
};

// Checks with the same trip conditions share this key (hotel/alert settings don't reset history).
export const configKey = (config: FlightsConfig) =>
  createHash("sha1").update(JSON.stringify(config.flight)).digest("hex").slice(0, 16);

// `history` = summaries of earlier checks with the same configKey, oldest first.
export async function judge(config: FlightsConfig, scrape: any, history: Summary[]) {
  const f = scrape.flight;
  if (f.minPrice == null) throw new Error(`항공권 가격을 읽지 못했습니다: ${f.url}`);

  const prior = history.map((h) => h.minPrice).sort((a, b) => a - b);
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

  // Hotels: keep results at or above the rating condition (in case Google's filter didn't
  // apply), then tag each one with Jev. Tags are cached per property name on this PC.
  let hotelCost = 0;
  if (scrape.hotel?.list) {
    const minRating = config.hotel.minRating || 0;
    const kept = scrape.hotel.list.filter((h: any) => !minRating || (h.rating ?? 0) >= minRating);
    let tags: TagCache = {};
    try { tags = JSON.parse(await readFile(tagFile, "utf8")); } catch {}
    try {
      hotelCost = (await tagHotels(kept, tags)).cost;
      await writeFile(tagFile, JSON.stringify(tags, null, 2), "utf8");
    } catch (e) {
      console.error("hotel tagging failed:", (e as Error).message);
    }
    scrape.hotel.list = kept.map((h: any) => ({ ...h, tag: tags[h.name]?.tag ?? null, tagConfidence: tags[h.name]?.confidence ?? null }));
    const prices = kept.map((h: any) => h.price).sort((a: number, b: number) => a - b);
    scrape.hotel.count = kept.length;
    scrape.hotel.minPricePerNight = prices[0] ?? null;
    scrape.hotel.medianPricePerNight = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  }

  const summary: Summary = {
    minPrice: f.minPrice, medianPrice: f.medianPrice, hotelMinPerNight: scrape.hotel?.minPricePerNight ?? null,
    isCheap, buyProbability, alert,
  };
  const snapshot = {
    ...scrape,
    config,
    verdict: { model: res.model, isCheap, buyProbability, hitTarget, alert, cost: res.usage.cost + hotelCost },
  };
  const won = (n: number | null) => (n == null ? "-" : `₩${n.toLocaleString("ko-KR")}`);
  const line = `${state.route} 최저 ${won(f.minPrice)} / 저렴 ${(isCheap * 100).toFixed(0)}% / 구매 ${(buyProbability * 100).toFixed(0)}%${alert ? " → 구매 추천" : ""}`;
  return { summary, snapshot, line };
}
