// Jev (TypeSafe decision model) via OpenRouter Decisions API. No dependencies.
// Needs OPENROUTER_API_KEY in the environment.

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
// "~typesafe/jev-latest" tracks the newest release; pin "typesafe/jev-1.14" for reproducibility.
export const DEFAULT_MODEL = "~typesafe/jev-latest";

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> };

export interface DecisionResponse<Q extends string = string> {
  id: string;
  model: string;
  provider: string;
  answers: Record<Q, Answer>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
}

export async function decide<Q extends string>(
  state: unknown,
  questions: Record<Q, Question>,
  model: string = DEFAULT_MODEL,
): Promise<DecisionResponse<Q>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state, questions }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return (await res.json()) as DecisionResponse<Q>;
}
