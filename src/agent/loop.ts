import Anthropic from "@anthropic-ai/sdk";
import { searchGoogle } from "../tools/serp.js";
import { scrapeUrl } from "../tools/crawl.js";
import type { RunConfig, ExtractedRecord, EmitFn } from "../types.js";
import type { LLMClient } from "./llm-client.js";
import { COMPARISON_DOMAINS } from "../lib/domains.js";
import { buildTools } from "./tools.js";
import { buildSystemPrompt } from "./prompts.js";
import { withRetry } from "../lib/retry.js";
import { normalizeUrl } from "../lib/url.js";

type ToolName =
  | "search_google"
  | "scrape_url"
  | "extract_structured_data"
  | "finish";

interface ToolInput {
  query?: string;
  url?: string;
  source_url?: string;
  records?: ExtractedRecord[];
  estimated_total?: number;
}

export async function runAgent(
  config: RunConfig,
  llmClient: LLMClient,
  serpApiKey: string,
  crawl4aiBase: string,
  onRecords?: (records: ExtractedRecord[]) => Promise<void>,
  emit?: EmitFn,
  signal?: AbortSignal
): Promise<ExtractedRecord[]> {
  const log = makeLog(emit);
  const tools = buildTools(config.schemaDef);
  const messages: Anthropic.MessageParam[] = [];
  const visitedUrls = new Set<string>();
  const urlDepth = new Map<string, number>();
  const allRecords: ExtractedRecord[] = [];

  messages.push({
    role: "user",
    content: `Research topic: "${config.topic}"\n\nFind all available data matching the schema. Be thorough and complete.`,
  });

  log("log", { message: `Starting agent for topic: ${config.topic}` });

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    if (signal?.aborted) {
      log("log", { message: "Agent cancelled." });
      break;
    }
    log("iter_state", {
      iteration: iteration + 1,
      maxIterations: config.maxIterations,
      visitedCount: visitedUrls.size,
      recordCount: allRecords.length,
    });

    const response = await withRetry(() => llmClient.messages.create({
      model: llmClient.agentModel,
      max_tokens: 8192,
      system: buildSystemPrompt(config, visitedUrls, allRecords.length),
      tools,
      tool_choice: { type: "any" },
      messages,
    }), log);

    // Add assistant turn
    messages.push({ role: "assistant", content: response.content });

    // Emit token usage
    if (response.usage) {
      log("tokens", { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    // Log any reasoning text
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        log("agent", { message: block.text.trim().slice(0, 300) });
      }
    }

    if (response.stop_reason === "end_turn") {
      log("log", { message: "Agent finished (end_turn)" });
      break;
    }

    if (response.stop_reason !== "tool_use") {
      break;
    }

    // Process tool calls
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Evaluate finish — may be rejected if coverage is insufficient.
    // Do NOT short-circuit here: if the agent called finish alongside other tools,
    // all tool calls must still receive a result (OpenAI-compatible APIs require it).
    const finishBlock = toolBlocks.find((b) => b.name === "finish");
    let finishRejectionMsg: string | null = null;
    if (finishBlock) {
      const finishInput = finishBlock.input as ToolInput;
      const estimatedTotal = typeof finishInput.estimated_total === "number" ? finishInput.estimated_total : null;
      const tooFewRecords = allRecords.length < 5 && visitedUrls.size >= 5;
      const belowEstimate = estimatedTotal !== null && allRecords.length < estimatedTotal * 0.7;
      const officialProviders = new Set(
        allRecords.filter(r => r._dataSource === "official").map(r => String(r[config.schemaDef.dedupeKey[1] ?? ""] ?? "").toLowerCase())
      );
      const comparisonOnlyProviders = allRecords
        .filter(r => r._dataSource === "comparison")
        .map(r => String(r[config.schemaDef.dedupeKey[1] ?? ""] ?? ""))
        .filter(name => name && !officialProviders.has(name.toLowerCase()));
      const uniqueComparisonOnly = [...new Set(comparisonOnlyProviders)].slice(0, 5);
      const hasUnvisitedProviders = uniqueComparisonOnly.length > 0;
      const notNearEnd = iteration < config.maxIterations - 3;
      if ((tooFewRecords || belowEstimate || hasUnvisitedProviders) && notNearEnd) {
        const reason = tooFewRecords
          ? `only ${allRecords.length} records found so far — keep scraping more provider pages`
          : belowEstimate
          ? `you estimated ${estimatedTotal} total results but only found ${allRecords.length} — keep searching and scraping to reach your estimate`
          : `these providers only have comparison data, no official pages scraped yet: ${uniqueComparisonOnly.join(", ")}`;
        log("log", { message: `Finish rejected (${reason}). Continuing…` });
        finishRejectionMsg = `Not done yet — ${reason}.`;
      }
    }

    // Mark new scrape URLs as visited upfront to prevent duplicate concurrent scrapes.
    // Only URLs not already visited are added — these are the ones we'll actually scrape.
    const newScrapeUrls = new Set<string>();
    for (const block of toolBlocks) {
      if (block.name === "scrape_url") {
        const url = (block.input as ToolInput).url!;
        if (!visitedUrls.has(normalizeUrl(url))) {
          visitedUrls.add(normalizeUrl(url));
          newScrapeUrls.add(url);
        }
      }
    }

    // Dispatch all tool calls concurrently (finish is handled inline below)
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolBlocks.map(async (block) => {
        const toolName = block.name as ToolName;
        const input = block.input as ToolInput;
        let resultContent = "";

        try {
          if (toolName === "search_google") {
            const query = input.query!;
            log("search", { query });
            const urls = await searchGoogle(query, serpApiKey);
            resultContent = JSON.stringify({ urls });
            log("search_done", { query, count: urls.length });

          } else if (toolName === "scrape_url") {
            const url = input.url!;
            if (!newScrapeUrls.has(url)) {
              resultContent = JSON.stringify({ error: "URL already scraped, skipping." });
            } else {
              const depth = urlDepth.get(url) ?? 0;
              if (depth > config.maxDepth) {
                resultContent = JSON.stringify({ error: `Max depth ${config.maxDepth} reached for this URL.` });
              } else {
                log("scrape_start", { url, depth });
                const result = await scrapeUrl(url, crawl4aiBase);
                for (const link of result.links) {
                  if (!urlDepth.has(link.url)) urlDepth.set(link.url, depth + 1);
                }
                resultContent = JSON.stringify({
                  markdown: result.markdown.slice(0, 50000),
                  links: result.links.slice(0, 150).map(l => l.url),
                });
                log("scrape_done", { url, depth, chars: result.markdown.length, links: result.links.length });
              }
            }

          } else if (toolName === "extract_structured_data") {
            const records = (input.records ?? []) as ExtractedRecord[];
            const srcUrl = String(input.source_url ?? "").toLowerCase();
            const isComparison = COMPARISON_DOMAINS.some((d) => srcUrl.includes(d));
            const tagged = records.map((r) => ({
              ...r,
              _dataSource: isComparison ? "comparison" : "official",
              _lastUpdated: new Date().toISOString().split("T")[0],
            }));
            allRecords.push(...tagged);
            if (onRecords && tagged.length > 0) await onRecords(tagged);
            log("extract", { url: input.source_url, count: records.length, total: allRecords.length });
            if (records.length === 0) {
              resultContent = JSON.stringify({ saved: 0, total_so_far: allRecords.length, hint: "No records saved — the identity fields were not found on this page. If this is a provider/entity page, check the links from the last scrape_url for a more specific subpage and scrape that." });
            } else {
              resultContent = JSON.stringify({ saved: records.length, total_so_far: allRecords.length });
            }
          } else if (toolName === "finish") {
            // Return rejection or acceptance result inline so all tool_use_ids get a response
            resultContent = finishRejectionMsg ?? "Done.";
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Ensure scrape_start is cleaned up in UI even on failure
          if (toolName === "scrape_url" && input.url) {
            log("scrape_done", { url: input.url, error: true });
          }
          log("error", { tool: toolName, message: msg });
          resultContent = JSON.stringify({ error: msg });
        }

        return { type: "tool_result" as const, tool_use_id: block.id, content: resultContent };
      })
    );

    messages.push({ role: "user", content: toolResults });

    // If finish was accepted (no rejection), wrap up
    if (finishBlock && !finishRejectionMsg) {
      const finalRecords = (finishBlock.input as ToolInput).records ?? [] as ExtractedRecord[];
      const seen = new Set(allRecords.map((r) => JSON.stringify(r)));
      for (const r of finalRecords as ExtractedRecord[]) {
        if (!seen.has(JSON.stringify(r))) {
          allRecords.push(r);
          seen.add(JSON.stringify(r));
        }
      }
      if (onRecords && (finalRecords as ExtractedRecord[]).length > 0) await onRecords(finalRecords as ExtractedRecord[]);
      log("finish", { total: allRecords.length });
      return allRecords;
    }

    // Sliding window: keep initial prompt + last CONTEXT_WINDOW iteration pairs
    trimMessages(messages);
  }

  log("log", { message: `Agent loop ended. ${allRecords.length} records collected.` });
  return allRecords;
}

const CONTEXT_WINDOW = 4; // keep last N assistant+user pairs

function trimMessages(messages: Anthropic.MessageParam[]): void {
  // messages[0] is always the initial user prompt
  // each iteration adds 2 messages: assistant + user(tool results)
  // keep initial + last CONTEXT_WINDOW*2
  if (messages.length > 1 + CONTEXT_WINDOW * 2) {
    messages.splice(1, messages.length - 1 - CONTEXT_WINDOW * 2);
  }
}


function makeLog(emit?: EmitFn) {
  return (type: string, payload: Record<string, unknown>) => {
    emit?.(type, payload);
    // Always mirror to stderr for CLI usage
    const msg = payload.message ?? formatPayload(type, payload);
    process.stderr.write(`[scrappy] ${msg}\n`);
  };
}

function formatPayload(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "search":      return `[search] ${p.query}`;
    case "search_done": return `  → ${p.count} URLs`;
    case "scrape_start": return `[scrape] depth=${p.depth} ${p.url}`;
    case "scrape_done":  return `  → ${p.chars} chars, ${p.links} links`;
    case "extract":     return `[extract] +${p.count} records from ${p.url} (total: ${p.total})`;
    case "finish":      return `[finish] ${p.total} total records`;
    case "error":       return `[error] ${p.tool}: ${p.message}`;
    case "agent":       return `[agent] ${p.message}`;
    case "iter_state":  return `[iter] ${p.iteration}/${p.maxIterations} · ${p.visitedCount} scraped · ${p.recordCount} records`;
    default:            return JSON.stringify(p);
  }
}
