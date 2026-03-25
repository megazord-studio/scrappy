import type { EmitFn } from "../types.js";

const TYPE_LABELS: Record<string, string> = {
  log: "log",
  search: "search",
  scrape: "scrape",
  extract: "extract",
  update: "update",
  finish: "finish",
  error: "error",
  iter: "iter",
};

export function formatLogLine(type: string, payload: Record<string, unknown>): string {
  // Format similar to existing makeLog/formatPayload in loop.ts
  if (type === "iter") {
    return `[iter] ${payload.iteration}/${payload.maxIterations} · ${payload.scraped} scraped · ${payload.records} records`;
  }
  if (type === "search") return `[search] ${payload.query ?? ""}`;
  if (type === "scrape") return `[scrape] depth=${payload.depth ?? 0} ${payload.url ?? ""}`;
  if (type === "extract") return `[extract] +${payload.count} records from ${payload.url} (total: ${payload.total})`;
  if (type === "update") {
    const status = payload.changed ? "changed" : "unchanged";
    return `[update] ${payload.url} → ${status}`;
  }
  if (type === "finish") return `[finish] ${payload.records} records`;
  if (payload.message) return `[${type}] ${payload.message}`;
  return `[${type}] ${JSON.stringify(payload)}`;
}

export function makeLogger(jobName: string, emit?: EmitFn) {
  return function log(type: string, payload: Record<string, unknown>) {
    const line = formatLogLine(type, payload);
    console.error(`[${jobName}] ${line}`);
    emit?.(type, payload);
  };
}
