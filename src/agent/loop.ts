import Anthropic from "@anthropic-ai/sdk";
import { searchGoogle } from "../tools/serp.js";
import { scrapeUrl } from "../tools/crawl.js";
import type { RunConfig, ExtractedRecord, EmitFn } from "../types.js";
import type { LLMClient } from "./llm-client.js";
import { COMPARISON_DOMAINS } from "../lib/domains.js";

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
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function buildTools(schemaDef: RunConfig["schemaDef"]): Anthropic.Tool[] {
  const fieldDescriptions = Object.entries(schemaDef.fieldDescriptions)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  return [
    {
      name: "search_google",
      description: "Search Google and return a list of relevant URLs for the given query.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
    {
      name: "scrape_url",
      description:
        "Scrape a URL using Crawl4AI and return its markdown content plus any links found on the page.",
      input_schema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "The URL to scrape" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_structured_data",
      description: `Save structured records you have extracted from a scraped page. Call this after every scrape, even if you found 0 records — pass an empty array if nothing matched.

Target schema fields:
${fieldDescriptions}

${schemaDef.namingRules && schemaDef.namingRules.length > 0 ? `Naming rules (critical for deduplication):\n${schemaDef.namingRules.map((r) => `- ${r}`).join("\n")}\n\n` : ""}Rules:
- Only include records where all required fields are clearly stated on the page — no guessing
- One record per distinct product or entity
- If a field has tiered values (e.g. varies by balance tier), capture them in a single record using the provider's own notation (e.g. "0.39%–0.75%" or "from 0.39%") — do NOT create separate records per tier
- URL field: use the provider's own official page URL if known; leave blank rather than using a comparison site URL`,
      input_schema: {
        type: "object" as const,
        properties: {
          source_url: {
            type: "string",
            description: "The URL the records were extracted from",
          },
          records: {
            type: "array",
            description: "The extracted records matching the schema",
            items: {
              type: "object",
              properties: Object.fromEntries(
                Object.keys(schemaDef.schema.shape).map((k) => [k, { type: "string" }])
              ),
            },
          },
        },
        required: ["source_url", "records"],
      },
    },
    {
      name: "finish",
      description:
        "Call this when you have collected all available data and are confident in the results. Pass all extracted records.",
      input_schema: {
        type: "object" as const,
        properties: {
          records: {
            type: "array",
            description: "All extracted records",
            items: { type: "object" },
          },
        },
        required: ["records"],
      },
    },
  ];
}

function buildSystemPrompt(
  config: RunConfig,
  visitedUrls?: Set<string>,
  recordCount?: number
): string {
  const fieldList = Object.entries(config.schemaDef.fieldDescriptions)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  const stateSection =
    visitedUrls && visitedUrls.size > 0
      ? `\n\nCurrent state: ${recordCount ?? 0} records found so far.\nAlready visited URLs — do NOT scrape again:\n${[...visitedUrls].map((u) => `  ${u}`).join("\n")}`
      : "";

  const seedSection = config.seedUrls?.length
    ? `\n\nSeed URLs — scrape these FIRST in your very first iteration (before any searches):\n${config.seedUrls.map((u) => `  ${u}`).join("\n")}`
    : "";

  return `You are a research agent that extracts structured data from the web.

Your task: Find complete, accurate data for the topic "${config.topic}".

Target data schema:
${fieldList}

Strategy:
1. Generate 2-3 targeted search queries (add terms like "Vergleich", "Zinssatz", "2025", "Schweiz")
2. Search Google for each query
3. Scrape comparison portals first (moneyland, comparis, evaluno, vermoegens-partner, schwiizerfranke, etc.)
4. After EVERY scrape, immediately call extract_structured_data with whatever records you found (even if 0)
5. From each comparison site, extract ALL links to individual bank/provider product pages and scrape those too — official provider pages are the authoritative source for current rates
6. From official bank pages, also extract records and prefer them over comparison site data
7. Continue until all providers found on comparison sites have been visited directly, then call finish${seedSection}

Rules:
- After every scrape_url call, you MUST call extract_structured_data — do not skip this step
- Comparison sites may have outdated rates — always try to scrape the official provider page directly
- On comparison sites, follow every link that leads to an individual bank or product page
- Only include records where you are fully confident — no guessing
- Never scrape the same URL twice
- A missed record is worse than an extra tool call — be exhaustive${stateSection}`;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  log: ReturnType<typeof makeLog>,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err instanceof Error && /5\d\d|overloaded|internal server error/i.test(err.message);
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = attempt * 5000;
      log("log", { message: `API error (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${err.message}` });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
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

    // Handle finish synchronously before dispatching parallel work
    const finishBlock = toolBlocks.find((b) => b.name === "finish");
    if (finishBlock) {
      const minScrapes = Math.min(20, Math.floor(config.maxIterations * 0.75));
      const tooFewScrapes = visitedUrls.size < minScrapes;
      const tooFewRecords = allRecords.length < 5 && visitedUrls.size >= 5;
      const notNearEnd = iteration < config.maxIterations - 3;
      if ((tooFewScrapes || tooFewRecords) && notNearEnd) {
        const reason = tooFewRecords
          ? `only ${allRecords.length} records found so far — keep scraping more provider pages`
          : `only ${visitedUrls.size} pages scraped out of expected ~${minScrapes}`;
        log("log", { message: `Finish rejected (${reason}). Continuing…` });
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: finishBlock.id, content: `Not done yet — ${reason}. Continue searching and scraping individual provider pages.` }] });
        continue;
      }
      const input = finishBlock.input as ToolInput;
      const finalRecords = (input.records ?? []) as ExtractedRecord[];
      const seen = new Set(allRecords.map((r) => JSON.stringify(r)));
      for (const r of finalRecords) {
        if (!seen.has(JSON.stringify(r))) {
          allRecords.push(r);
          seen.add(JSON.stringify(r));
        }
      }
      if (onRecords && finalRecords.length > 0) await onRecords(finalRecords);
      log("finish", { total: allRecords.length });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: finishBlock.id, content: "Done." }] });
      return allRecords;
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

    // Dispatch all tool calls concurrently
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
            resultContent = JSON.stringify({ saved: records.length, total_so_far: allRecords.length });
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
