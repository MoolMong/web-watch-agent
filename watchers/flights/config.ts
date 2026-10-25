// Trip conditions for the flights watcher. Requests from the dashboard pass through
// validateConfig before they are saved; only known fields are kept.
export type FlightsConfig = {
  flight: {
    origin: string; destination: string; departDate: string; returnDate: string;
    adults: number; currency: "KRW"; targetPrice: number;
  };
  hotel: { enabled: boolean; query: string; checkIn: string; checkOut: string; minRating: number };
  alert: { minBuyProbability: number };
};

export const defaultConfig: FlightsConfig = {
  flight: {
    origin: "ICN", destination: "NRT", departDate: "2026-12-10", returnDate: "2026-12-14",
    adults: 1, currency: "KRW", targetPrice: 300000,
  },
  hotel: { enabled: true, query: "Tokyo hotels", checkIn: "2026-12-10", checkOut: "2026-12-14", minRating: 4 },
  alert: { minBuyProbability: 0.7 },
};

const date = /^\d{4}-\d{2}-\d{2}$/;

export function validateConfig(raw: any): FlightsConfig {
  const fail = (msg: string): never => { throw new Error(msg); };
  const f = raw?.flight ?? fail("flight 항목이 없습니다.");
  const h = raw.hotel ?? {};
  const a = raw.alert ?? {};

  const origin = String(f.origin ?? "").toUpperCase();
  const destination = String(f.destination ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) fail("공항 코드는 영문 3글자여야 합니다.");
  if (origin === destination) fail("출발 공항과 도착 공항이 같습니다.");
  if (!date.test(f.departDate)) fail("가는 날 형식이 잘못됐습니다.");
  const returnDate = f.returnDate ? String(f.returnDate) : "";
  if (returnDate && (!date.test(returnDate) || returnDate < f.departDate)) fail("오는 날이 가는 날보다 빠르거나 형식이 잘못됐습니다.");
  const adults = Number(f.adults);
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) fail("성인은 1~9명이어야 합니다.");
  const targetPrice = Number(f.targetPrice);
  if (!Number.isFinite(targetPrice) || targetPrice < 0) fail("목표가가 잘못됐습니다.");
  const minRating = Number(h.minRating ?? 0);
  if (![0, 3.5, 4, 4.5].includes(minRating)) fail("호텔 최소 평점은 0, 3.5, 4, 4.5 중 하나여야 합니다.");
  const minBuyProbability = Number(a.minBuyProbability ?? 0.7);
  if (!(minBuyProbability >= 0.05 && minBuyProbability <= 1)) fail("알림 민감도가 잘못됐습니다.");

  return {
    flight: { origin, destination, departDate: f.departDate, returnDate, adults, currency: "KRW", targetPrice },
    hotel: { enabled: Boolean(h.enabled), query: String(h.query ?? "").slice(0, 100), checkIn: f.departDate, checkOut: returnDate, minRating },
    alert: { minBuyProbability },
  };
}
