// Minimal Supabase (PostgREST) client for the PC agent. Uses the secret key, which bypasses
// row level security, so it must only ever live in this PC's environment variables.
const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;

function headers(extra: Record<string, string> = {}) {
  if (!URL_ || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  const h: Record<string, string> = { apikey: KEY, "Content-Type": "application/json", ...extra };
  if (KEY.startsWith("eyJ")) h.Authorization = `Bearer ${KEY}`; // legacy service_role JWT
  return h;
}

async function call<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: headers(prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]} ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const db = {
  select: <T>(table: string, query: string) => call<T[]>("GET", `${table}?${query}`),
  insert: <T>(table: string, row: unknown) => call<T[]>("POST", table, row, "return=representation"),
  upsert: (table: string, row: unknown) => call("POST", table, row, "resolution=merge-duplicates,return=minimal"),
  update: (table: string, query: string, patch: unknown) => call("PATCH", `${table}?${query}`, patch, "return=minimal"),
};

export type Request = { id: number; watcher: string; config: unknown | null; status: string; created_at: string };
export type Check = { id: number; watcher: string; checked_at: string; config_key: string; summary: any; snapshot: any };
