// Validates a config sent from the dashboard (via a "[run] flights" issue) and writes
// docs/flights/config.json. Only known fields are copied; anything else is dropped.
// Usage: node watchers/flights/apply-config.ts <request.json>
import { readFile, writeFile } from "node:fs/promises";

// Errors go to stdout so the PowerShell caller can capture them without stderr redirection.
const fail = (msg: string): never => { console.log(msg); process.exit(2); };
const date = /^\d{4}-\d{2}-\d{2}$/;

const req = JSON.parse(await readFile(process.argv[2], "utf8"));
const f = req.flight ?? fail("flight 항목이 없습니다.");
const h = req.hotel ?? {};
const a = req.alert ?? {};

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

const config = {
  flight: { origin, destination, departDate: f.departDate, returnDate, adults, currency: "KRW", targetPrice },
  hotel: {
    enabled: Boolean(h.enabled),
    query: String(h.query ?? "").slice(0, 100),
    checkIn: f.departDate,
    checkOut: returnDate,
    minRating,
  },
  alert: { minBuyProbability },
};

await writeFile(new URL("../../docs/flights/config.json", import.meta.url), JSON.stringify(config, null, 2) + "\n", "utf8");
console.log(`config: ${origin}->${destination} ${f.departDate}~${returnDate || "편도"} 성인${adults}`);
