// PC agent: stays running while you are logged on (started by scripts/start-agent.ps1).
//  - every few seconds, picks up "지금 검색" requests from Supabase and runs them
//  - runs each watcher on its schedule (e.g. every 3 h) using the config saved in Supabase
//  - stores every check in Supabase for the dashboard
// One check runs at a time. Usage: node core/agent.ts            (run forever)
//                                  node core/agent.ts --once flights  (one check, then exit)
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db, type Request, type Check } from "./db.ts";
import flights from "../watchers/flights/index.ts";

const WATCHERS = { flights } as const;
type WatcherId = keyof typeof WATCHERS;
const POLL_MS = 5_000;
const logFile = new URL("./.tmp/agent.log", import.meta.url);

async function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  await mkdir(new URL("./.tmp/", import.meta.url), { recursive: true });
  await appendFile(logFile, line + "\n", "utf8");
}

async function loadConfig(id: WatcherId) {
  const w = WATCHERS[id];
  const [row] = await db.select<{ config: unknown }>("watch_configs", `watcher=eq.${id}&select=config`);
  if (row) return w.validateConfig(row.config);
  await db.upsert("watch_configs", { watcher: id, config: w.defaultConfig });
  return w.defaultConfig;
}

function scrape(id: WatcherId): Promise<void> {
  const script = pathToFileURL(fileURLToPath(new URL(`../watchers/${id}/scrape.mjs`, import.meta.url))).href;
  return new Promise((resolve, reject) => {
    const p = spawn("ego-browser", ["nodejs", "-e", `await import('${script}')`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let err = "";
    p.stdout.on("data", (d) => process.stdout.write(d));
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`scrape exited ${code}: ${err.trim().split("\n").slice(-3).join(" ")}`))));
  });
}

async function runCheck(id: WatcherId, requestId: number | null = null) {
  const w = WATCHERS[id];
  const config = await loadConfig(id);
  const key = w.configKey(config);
  const tmp = new URL(`../watchers/${id}/.tmp/`, import.meta.url);
  await mkdir(tmp, { recursive: true });
  await writeFile(new URL("config.json", tmp), JSON.stringify(config, null, 2), "utf8");

  await scrape(id);
  const scraped = JSON.parse(await readFile(new URL("scrape.json", tmp), "utf8"));
  const prior = await db.select<Check>("watch_checks",
    `watcher=eq.${id}&config_key=eq.${key}&select=summary&order=checked_at.asc&limit=500`);
  const { summary, snapshot, line } = await w.judge(config, scraped, prior.map((c) => c.summary));
  await db.insert("watch_checks", { watcher: id, checked_at: scraped.checkedAt, config_key: key, summary, snapshot, request_id: requestId });
  await log(`${id}: ${line}`);
  return line;
}

async function handleRequests() {
  const pending = await db.select<Request>("watch_requests", "status=eq.pending&order=created_at.asc&limit=20");
  if (!pending.length) return false;
  // Only the newest request per watcher matters; older ones are superseded.
  const latest = new Map<string, Request>();
  for (const r of pending) latest.set(r.watcher, r);
  for (const r of pending) {
    if (latest.get(r.watcher) !== r) {
      await db.update("watch_requests", `id=eq.${r.id}`, { status: "done", message: `더 최근 요청 #${latest.get(r.watcher)!.id}으로 대체`, finished_at: new Date().toISOString() });
    }
  }
  for (const r of latest.values()) {
    const done = (status: "done" | "error", message: string) =>
      db.update("watch_requests", `id=eq.${r.id}`, { status, message, finished_at: new Date().toISOString() });
    if (!(r.watcher in WATCHERS)) { await done("error", `알 수 없는 감시 대상: ${r.watcher}`); continue; }
    const id = r.watcher as WatcherId;
    await db.update("watch_requests", `id=eq.${r.id}`, { status: "running", started_at: new Date().toISOString() });
    try {
      if (r.config) {
        const config = WATCHERS[id].validateConfig(r.config);
        await db.upsert("watch_configs", { watcher: id, config, updated_at: new Date().toISOString() });
        await log(`${id}: config updated by request #${r.id}`);
      }
      await done("done", await runCheck(id, r.id));
    } catch (e) {
      await log(`${id}: request #${r.id} failed: ${(e as Error).message}`);
      await done("error", (e as Error).message.slice(0, 500));
    }
  }
  return true;
}

async function runDueSchedules() {
  for (const [id, w] of Object.entries(WATCHERS) as [WatcherId, (typeof WATCHERS)[WatcherId]][]) {
    const [last] = await db.select<Check>("watch_checks", `watcher=eq.${id}&select=checked_at&order=checked_at.desc&limit=1`);
    const age = last ? Date.now() - Date.parse(last.checked_at) : Infinity;
    if (age < w.intervalHours * 3_600_000) continue;
    try { await runCheck(id); } catch (e) { await log(`${id}: scheduled check failed: ${(e as Error).message}`); }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.argv[2] === "--once") {
  const id = (process.argv[3] ?? "flights") as WatcherId;
  console.log(await runCheck(id));
} else {
  await log(`agent started (${Object.keys(WATCHERS).join(", ")})`);
  let lastScheduleCheck = 0;
  for (;;) {
    try {
      await handleRequests();
      if (Date.now() - lastScheduleCheck > 60_000) { lastScheduleCheck = Date.now(); await runDueSchedules(); }
    } catch (e) {
      await log(`loop error: ${(e as Error).message}`);
      await sleep(30_000);
    }
    await sleep(POLL_MS);
  }
}
