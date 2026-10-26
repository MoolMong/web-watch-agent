// Delivers alert events. Both channels are off unless enabled by environment variables:
//  - WWA_TOAST=1   Windows notification on this PC (scripts/toast.ps1)
//  - NTFY_TOPIC    ntfy.sh push to your phone (install the ntfy app and subscribe to that topic)
// Events are always stored in Supabase, so the dashboard lists them either way.
// ntfy topics are public by name, so use a long random topic and keep it to yourself.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DASHBOARD_URL = process.env.WWA_DASHBOARD_URL || "https://moolmong.github.io/web-watch-agent/";
export type Alert = { kind: "buy" | "target" | "lowest"; title: string; body: string; url: string };

function toast(a: Alert): Promise<void> {
  const script = fileURLToPath(new URL("../scripts/toast.ps1", import.meta.url));
  return new Promise((resolve) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      env: { ...process.env, WWA_TOAST_TITLE: a.title, WWA_TOAST_BODY: a.body, WWA_TOAST_URL: a.url },
      windowsHide: true, stdio: "ignore",
    });
    p.on("close", () => resolve());
    p.on("error", () => resolve());
  });
}

async function ntfy(a: Alert) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    body: a.body,
    // ntfy reads non-ASCII header values as RFC 2047 when encoded; plain UTF-8 in the body is fine.
    headers: { Title: `=?UTF-8?B?${Buffer.from(a.title).toString("base64")}?=`, Click: a.url, Tags: a.kind === "buy" ? "airplane,money_with_wings" : "chart_with_downwards_trend" },
  });
}

export async function deliver(alerts: Alert[]) {
  if (!alerts.length) return;
  // One notification per check: the most important event, with the others mentioned.
  const order = { buy: 0, target: 1, lowest: 2 } as const;
  const [top, ...rest] = alerts.slice().sort((a, b) => order[a.kind] - order[b.kind]);
  const merged = { ...top, body: rest.length ? `${top.body}\n${rest.map((r) => r.title.split(" · ")[0]).join(", ")}도 해당` : top.body };
  await Promise.allSettled([process.env.WWA_TOAST === "1" ? toast(merged) : Promise.resolve(), ntfy(merged)]);
}
