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
import { deliver, DASHBOARD_URL, type Alert } from "./notify.ts";

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

// Hours between scheduled checks: the watch's own setting, else the watcher's default.
const ALLOWED_INTERVALS = [1, 3, 6, 12, 24];
function intervalOf(watch: Watch) {
  const h = Number((watch.config as any)?.intervalHours);
  return ALLOWED_INTERVALS.includes(h) ? h : WATCHERS[watch.watcher as WatcherId]?.intervalHours ?? 3;
}
const nextCheck = (watch: Watch, from = Date.now()) => new Date(from + intervalOf(watch) * 3_600_000).toISOString();

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

    await heartbeat(watch.id, true);
    await scrape(id);
    const scraped = JSON.parse(await readFile(new URL("scrape.json", tmp), "utf8"));
    const prior = await db.select<Check>("watch_checks",
      `watch_id=eq.${watch.id}&config_key=eq.${key}&select=summary&order=checked_at.asc&limit=500`);
    const { summary, snapshot, line } = await w.judge(config, scraped, prior.map((c) => c.summary));
    await db.insert("watch_checks", {
      watcher: id, watch_id: watch.id, checked_at: scraped.checkedAt, config_key: key, summary, snapshot, request_id: requestId,
    });
    // Trend for the list: previous summary (same conditions only) and the lowest fare seen so far.
    const prices = [...prior.map((c) => c.summary?.minPrice), summary.minPrice].filter((p): p is number => typeof p === "number");
    await db.update("watches", `id=eq.${watch.id}`, {
      last_checked_at: scraped.checkedAt, last_summary: summary, last_error: null, next_check_at: nextCheck(watch),
      prev_summary: prior.at(-1)?.summary ?? null,
      lowest_price: prices.length ? Math.min(...prices) : null,
    });
    await log(`watch #${watch.id}: ${line}`);

    // Notify on state changes only (see events() in the watcher).
    const url = `${DASHBOARD_URL}${id}/#w=${watch.id}`;
    const alerts: Alert[] = w.events(config, summary, {
      last_summary: watch.last_summary as any, lowest_price: watch.lowest_price, hadHistory: prior.length > 0,
    }).map((e) => ({ ...e, url }));
    if (alerts.length) {
      await db.insert("watch_events", alerts.map((a) => ({ watch_id: watch.id, kind: a.kind, title: a.title, body: a.body, url: a.url })));
      await deliver(alerts);
      await log(`watch #${watch.id}: notified ${alerts.map((a) => a.kind).join(", ")}`);
    }
    return line;
  } catch (e) {
    // Record the failure on the watch so the list shows it, and don't retry it for a full interval.
    const message = (e as Error).message.slice(0, 500);
    await db.update("watches", `id=eq.${watch.id}`, { last_checked_at: now(), last_error: message, next_check_at: nextCheck(watch) }).catch(() => {});
    throw e;
  } finally {
    await heartbeat(null, true);
  }
}

// ---- heartbeat: lets the dashboard show whether this PC is online and what it is doing ----
const startedAt = now();
let lastBeat = 0;
async function heartbeat(busyWatchId: number | null, force = false) {
  if (!force && Date.now() - lastBeat < 20_000) return;
  lastBeat = Date.now();
  const pending = await db.select<{ id: number }>("watch_requests", "status=eq.pending&select=id&limit=100").catch(() => []);
  await db.upsert("agent_status", { id: "pc", last_seen: now(), started_at: startedAt, busy_watch_id: busyWatchId, queue: pending.length })
    .catch((e) => log(`heartbeat failed: ${(e as Error).message}`));
}

// ---- turn off watches whose departure date has passed (local date of this PC) ----
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
let lastExpireCheck = 0;
async function expireOldWatches() {
  if (Date.now() - lastExpireCheck < 10 * 60_000) return;
  lastExpireCheck = Date.now();
  const fields = Object.entries(WATCHERS).filter(([, w]) => w.expiresOn);
  const old = (await Promise.all(fields.map(([id, w]) =>
    db.select<Watch>("watches", `watcher=eq.${id}&enabled=eq.true&config->${w.expiresOn}=lt.${localToday()}&select=id`)))).flat();
  if (!old.length) return;
  await db.update("watches", `id=in.(${old.map((w) => w.id).join(",")})`, { enabled: false, last_error: "출발일이 지나 자동으로 껐습니다." });
  await log(`turned off ${old.length} past watch(es): ${old.map((w) => w.id).join(", ")}`);
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
    const [due] = await db.select<Watch>("watches",
      `watcher=eq.${id}&enabled=eq.true${w.expiresOn ? `&config->${w.expiresOn}=gte.${localToday()}` : ""}&or=(next_check_at.is.null,next_check_at.lte."${now()}")&order=next_check_at.asc.nullsfirst&limit=1`);
    if (!due) continue;
    try { await runWatch(due); } catch (e) { await log(`watch #${due.id}: scheduled check failed: ${(e as Error).message}`); }
    return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Only one agent may run: two would share one ego task space and break each other's scrapes.
async function acquireLock() {
  const lock = new URL("./.tmp/agent.lock", import.meta.url);
  await mkdir(new URL("./.tmp/", import.meta.url), { recursive: true });
  try {
    const pid = Number(await readFile(lock, "utf8"));
    if (pid && pid !== process.pid) { process.kill(pid, 0); return false; } // throws if that process is gone
  } catch {}
  await writeFile(lock, String(process.pid), "utf8");
  return true;
}

if (process.argv[2] === "--once") {
  const [watch] = await db.select<Watch>("watches", `id=eq.${Number(process.argv[3])}`);
  if (!watch) throw new Error(`watch ${process.argv[3]} not found`);
  console.log(await runWatch(watch));
} else {
  if (!(await acquireLock())) { console.log("another agent is already running; exiting"); process.exit(0); }
  await log(`agent started (${Object.keys(WATCHERS).join(", ")})`);
  for (;;) {
    try {
      await heartbeat(null);
      await expireOldWatches();
      if (!(await handleRequests())) await runOneDueWatch();
    } catch (e) {
      await log(`loop error: ${(e as Error).message}`);
      await sleep(30_000);
    }
    await sleep(POLL_MS);
  }
}
