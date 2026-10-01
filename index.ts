/**
 * Llama-server metrics extension
 *
 * Polls a local llama.cpp preset server (/v1/models + /metrics) and shows
 * live throughput, speculative-decoding acceptance, and load in the pi
 * status bar.
 *
 * Env vars:
 *   LLAMA_METRICS_URL          base URL        (default http://127.0.0.1:8080)
 *   LLAMA_METRICS_INTERVAL_MS  poll interval   (default 5000)
 *   LLAMA_METRICS_TIMEOUT_MS   fetch timeout   (default 3000)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const KEY = "pi-llama-server-metrics";
const BASE = (process.env.LLAMA_METRICS_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const INTERVAL = Number(process.env.LLAMA_METRICS_INTERVAL_MS) || 5000;
const TIMEOUT = Number(process.env.LLAMA_METRICS_TIMEOUT_MS) || 3000;

const num = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number): string =>
  n < 1e3 ? String(Math.round(n)) : n < 1e6 ? `${(n / 1e3).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`;

interface ModelInfo {
  id: string;
  status?: { value?: string };
}

type PollResult =
  | { kind: "down" }
  | { kind: "idle" }
  | { kind: "metrics"; model: string; m: Record<string, number> };

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function poll(): Promise<PollResult> {
  let models: { data?: ModelInfo[] } | undefined;
  try {
    models = (await fetchJson(`${BASE}/v1/models`)) as { data?: ModelInfo[] };
  } catch {
    return { kind: "down" };
  }

  const loaded = (models.data ?? []).find((m) => m.status?.value === "loaded");
  if (!loaded) return { kind: "idle" };

  try {
    const res = await fetch(`${BASE}/metrics?model=${encodeURIComponent(loaded.id)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { kind: "metrics", model: loaded.id, m: {} };
    const m: Record<string, number> = {};
    for (const line of (await res.text()).split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const sp = line.indexOf(" ");
      if (sp === -1) continue;
      m[line.slice(0, sp).split("{")[0]] = Number(line.slice(sp + 1)) || 0;
    }
    return { kind: "metrics", model: loaded.id, m };
  } catch {
    return { kind: "metrics", model: loaded.id, m: {} };
  }
}

export default function llamaServerMetrics(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function tick(ctx: ExtensionContext): Promise<void> {
    if (busy) return; // previous poll still in flight
    busy = true;
    try {
      const r = await poll();
      switch (r.kind) {
        case "down":
          ctx.ui.setStatus(KEY, `🦙 ${ctx.ui.theme.fg("warning", "llama-server unreachable")}`);
          break;
        case "idle":
          ctx.ui.setStatus(KEY, `${ctx.ui.theme.fg("accent", "🦙")} ${ctx.ui.theme.fg("dim", "no model loaded")}`);
          break;
        case "metrics": {
          const m = r.m;
          const totalTok = m["llamacpp:tokens_predicted_total"] || 0;
          const totalSec = m["llamacpp:tokens_predicted_seconds_total"] || 0;
          const tps = totalTok > 0 && totalSec > 0 ? totalTok / totalSec : 0;
          const draft = m["llamacpp:spec_decode_num_draft_tokens_total"] || 0;
          const accept = m["llamacpp:spec_decode_num_accepted_tokens_total"] || 0;
          const busyReq = (m["llamacpp:requests_processing"] || 0) + (m["llamacpp:requests_deferred"] || 0);
          const ctxTok = m["llamacpp:n_tokens_max"] || 0;

          const parts: string[] = [];
          if (tps > 0) parts.push(ctx.ui.theme.fg("success", `${tps.toFixed(1)} t/s`));
          if (totalTok > 0) parts.push(ctx.ui.theme.fg("text", `${fmt(totalTok)} tok`));
          if (draft > 0) parts.push(ctx.ui.theme.fg("text", `spec ${Math.round((accept / draft) * 100)}%`));
          if (busyReq > 0) parts.push(ctx.ui.theme.fg("warning", `busy:${busyReq}`));
          if (ctxTok > 0) parts.push(ctx.ui.theme.fg("dim", `ctx ${ctxTok}`));

          ctx.ui.setStatus(
            KEY,
            [ctx.ui.theme.fg("accent", `🦙 ${r.model}`), ...parts].filter(Boolean).join(" "),
          );
          break;
        }
      }
    } catch {
      ctx.ui.setStatus(KEY, `🦙 ${ctx.ui.theme.fg("warning", "metrics error")}`);
    } finally {
      busy = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    void tick(ctx);
    timer = setInterval(() => {
      void tick(ctx);
    }, INTERVAL);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    ctx.ui.setStatus(KEY, undefined);
  });
}
