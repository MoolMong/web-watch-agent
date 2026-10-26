// PC agent: stays running while you are logged on (started by scripts/start-agent.ps1).
//  - every few seconds, picks up "검색" requests from Supabase and runs those watches now
//  - runs every enabled watch on its watcher's schedule (e.g. every 3 h)
//  - stores every check in Supabase and keeps each watch's latest summary for the list view
// One check runs at a time. Usage: node core/agent.ts               (run forever)
//                                  node core/agent.ts --once <watchId>  (one check, then exit)
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db, type Request, type Check, type Watch } from "./db.ts";
import flights from "../watchers/flights/index.ts";

const WATCHERS = { flights } as const;
type WatcherId = keyof typeof WATCHERS;
const POLL_MS = 5_000;
const logFile = new URL("./.tmp/agent.log", import.meta.url);
const now = () => new Date().toISOString();

async function log(msg: string) {
  const line = `[${now()}] ${msg}`;
  console.log(line);
  await mkdir(new URL("./.tmp/", import.meta.url), { recursive: true });
  await appendFile(logFile, line + "\n", "utf8");
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

async function runWatch(watch: Watch, requestId: number | null = null) {
  if (!(watch.watcher in WATCHERS)) throw new Error(`알 수 없는 감시 대상: ${watch.watcher}`);
  const id = watch.watcher as WatcherId;
  const w = WATCHERS[id];
  try {
    const config = w.validateConfig(watch.config);
    const key = w.configKey(config);
    const tmp = new URL(`../watchers/${id}/.tmp/`, import.meta.url);
    await mkdir(tmp, { recursive: true });
    await writeFile(new URL("config.json", tmp), JSON.stringify(config, null, 2), "utf8");

    await scrape(id);
    const scraped = JSON.parse(await readFile(new URL("scrape.json", tmp), "utf8"));
    const prior = await db.select<Check>("watch_checks",
      `watch_id=eq.${watch.id}&config_key=eq.${key}&select=summary&order=checked_at.asc&limit=500`);
    const { summary, snapshot, line } = await w.judge(config, scraped, prior.map((c) => c.summary));
    await db.insert("watch_checks", {
      watcher: id, watch_id: watch.id, checked_at: scraped.checkedAt, config_key: key, summary, snapshot, request_id: requestId,
    });
    await db.update("watches", `id=eq.${watch.id}`, { last_checked_at: scraped.checkedAt, last_summary: summary, last_error: null });
    await log(`watch #${watch.id}: ${line}`);
    return line;
  } catch (e) {
    // Record the failure on the watch so the list shows it, and don't retry it for a full interval.
    const message = (e as Error).message.slice(0, 500);
    await db.update("watches", `id=eq.${watch.id}`, { last_checked_at: now(), last_error: message }).catch(() => {});
    throw e;
  }
}

async function handleRequests() {
  const pending = await db.select<Request>("watch_requests", "status=eq.pending&order=created_at.asc&limit=50");
  if (!pending.length) return false;
  // One run per watch even if it was requested several times.
  const latest = new Map<number, Request>();
  for (const r of pending) if (r.watch_id != null) latest.set(r.watch_id, r);
  for (const r of pending) {
    const done = (status: "done" | "error", message: string) =>
      db.update("watch_requests", `id=eq.${r.id}`, { status, message, finished_at: now() });
    if (r.watch_id == null) { await done("error", "감시가 지정되지 않은 요청입니다."); continue; }
    if (latest.get(r.watch_id) !== r) { await done("done", `같은 감시의 요청 #${latest.get(r.watch_id)!.id}과 합쳐 처리`); continue; }
    const [watch] = await db.select<Watch>("watches", `id=eq.${r.watch_id}`);
    if (!watch) { await done("error", "삭제된 감시입니다."); continue; }
    await db.update("watch_requests", `id=eq.${r.id}`, { status: "running", started_at: now() });
    try {
      await done("done", await runWatch(watch, r.id));
    } catch (e) {
      await log(`watch #${watch.id}: request #${r.id} failed: ${(e as Error).message}`);
      await done("error", (e as Error).message.slice(0, 500));
    }
  }
  return true;
}

// Runs at most one due watch per call so dashboard requests are never stuck behind a long queue.
async function runOneDueWatch() {
  for (const [id, w] of Object.entries(WATCHERS) as [WatcherId, (typeof WATCHERS)[WatcherId]][]) {
    const cutoff = new Date(Date.now() - w.intervalHours * 3_600_000).toISOString();
    const [due] = await db.select<Watch>("watches",
      `watcher=eq.${id}&enabled=eq.true&or=(last_checked_at.is.null,last_checked_at.lt."${cutoff}")&order=last_checked_at.asc.nullsfirst&limit=1`);
    if (!due) continue;
    try { await runWatch(due); } catch (e) { await log(`watch #${due.id}: scheduled check failed: ${(e as Error).message}`); }
    return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.argv[2] === "--once") {
  const [watch] = await db.select<Watch>("watches", `id=eq.${Number(process.argv[3])}`);
  if (!watch) throw new Error(`watch ${process.argv[3]} not found`);
  console.log(await runWatch(watch));
} else {
  await log(`agent started (${Object.keys(WATCHERS).join(", ")})`);
  for (;;) {
    try {
      if (!(await handleRequests())) await runOneDueWatch();
    } catch (e) {
      await log(`loop error: ${(e as Error).message}`);
      await sleep(30_000);
    }
    await sleep(POLL_MS);
  }
}
