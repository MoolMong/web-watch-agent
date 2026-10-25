// Classifies lodging into capsule / dorm (shared room) / private with Jev, caching by name so each
// property is paid for once. The dashboard uses the tag to hide capsule hotels or shared rooms.
import { decide, type Question } from "../../core/jev.ts";

export type LodgingTag = "capsule" | "dorm" | "private";
export type TagCache = Record<string, { tag: LodgingTag; confidence: number; model: string; taggedAt: string }>;

type Hotel = { name: string; stars: number | null; amenities: string[]; price: number; rating: number | null };

const CRITERIA: Record<LodgingTag, string> = {
  capsule: "Capsule or pod hotel: guests sleep in individual capsules/pods, usually with shared bathrooms and lounges.",
  dorm: "Hostel or guesthouse whose main offering is dormitory beds: several beds or bunks for different guests in one shared room.",
  private: "Regular hotel, ryokan, apartment, or guesthouse where guests get a private room.",
};
const BATCH = 15;

export async function tagHotels(hotels: Hotel[], cache: TagCache): Promise<{ cache: TagCache; cost: number }> {
  const todo = hotels.filter((h) => !cache[h.name]);
  let cost = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const state = {
      lodgings: batch.map((h, j) => ({
        id: `h${j}`, name: h.name, star_class: h.stars, amenities: h.amenities, nightly_price_krw: h.price, guest_rating: h.rating,
      })),
    };
    const questions: Record<string, Question> = {};
    batch.forEach((h, j) => {
      questions[`h${j}`] = {
        type: "choice",
        instructions: `What kind of lodging is "${h.name}" (id h${j}) for a typical booking? Judge mainly from the name (words like capsule, cabin, pod, hostel, dorm, bunk, guesthouse) and the other fields.`,
        criteria: CRITERIA,
      };
    });
    const res = await decide(state, questions);
    cost += res.usage.cost;
    batch.forEach((h, j) => {
      const a = res.answers[`h${j}`];
      if (a?.type === "choice") {
        cache[h.name] = { tag: a.choice as LodgingTag, confidence: a.confidence, model: res.model, taggedAt: new Date().toISOString() };
      }
    });
  }
  return { cache, cost };
}
