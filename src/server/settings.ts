import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const SETTINGS_FILE = resolve("data/settings.json");

export interface Settings {
  llmProvider: "anthropic" | "openai" | "zordmind";
  anthropicAgentModel: string;
  anthropicExtractModel: string;
  openaiModel: string;
  openaiExtractModel: string;
  zordmindUrl: string;
  zordmindModel: string;
  crawl4aiBase: string;
  apiKey: string;
  webhookUrl: string;
}

const DEFAULTS: Settings = {
  llmProvider: "anthropic",
  anthropicAgentModel: "claude-opus-4-6",
  anthropicExtractModel: "claude-haiku-4-5-20251001",
  openaiModel: "gpt-5.4",
  openaiExtractModel: "gpt-5.4-mini",
  zordmindUrl: "https://inference.kube.megazord.studio",
  zordmindModel: "qwen3-32b",
  crawl4aiBase: process.env.CRAWL4AI_BASE ?? "https://crawl.naszilla.ch",
  apiKey: "",
  webhookUrl: "",
};

export function readSettings(): Settings {
  try {
    if (!existsSync(SETTINGS_FILE)) return { ...DEFAULTS };
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings();
  const updated = { ...current, ...patch };
  mkdirSync(resolve("data"), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
