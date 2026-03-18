import OpenAI from "openai";
import { searchGoogle } from "../tools/serp.js";
import { scrapeUrl } from "../tools/crawl.js";
import type { RunConfig, ExtractedRecord, EmitFn } from "../types.js";
import type { OpenAILLMClient } from "./llm-client.js";
import { COMPARISON_DOMAINS } from "../lib/domains.js";

type ToolName = "search_google" | "scrape_url" | "extract_structured_data" | "finish";

interface ToolInput {
  query?: string;
  url?: string;
  source_url?: string;
  records?: ExtractedRecord[];
}

function buildTools(schemaDef: RunConfig["schemaDef"]): OpenAI.ChatCompletionTool[] {
  const fieldDescriptions = Object.entries(schemaDef.fieldDescriptions)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  const namingSection = schemaDef.namingRules?.length
    ? `\nNaming rules:\n${schemaDef.namingRules.map((r) => `- ${r}`).join("\n")}`
    : "";

  return [
    {
      type: "function",
      function: {
        name: "search_google",
        description: "Search Google and return a list of relevant URLs.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scrape_url",
        description: "Fetch a web page and return its text content and outbound links.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "extract_structured_data",
        description: `Save structured records extracted from a page to the dataset.

Schema fields:
${fieldDescriptions}${namingSection}

Rules:
- Call this after every scrape_url call, even if you found 0 records (pass empty array)
- Only include records where all required fields are present and clearly stated — no guessing
- One record per clearly distinct named product. If a page describes multiple variations of the same product (e.g. fund strategies within one product family, or the same product under slightly different names), extract ONE record for the product — do not create multiple records for what is essentially the same offering
- For the url field: use the official provider page URL, never a comparison/aggregator site URL`,
        parameters: {
          type: "object",
          properties: {
            source_url: {
              type: "string",
              description: "The URL these records were extracted from",
            },
            records: {
              type: "array",
              description: "Extracted records matching the schema",
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
    },
    {
      type: "function",
      function: {
        name: "finish",
        description:
          "Call this when you have visited all available sources and the dataset is complete.",
        parameters: {
          type: "object",
          properties: {
            records: {
              type: "array",
              items: { type: "object" },
            },
          },
          required: ["records"],
        },
      },
    },
  ];
}

function buildSystemPrompt(
  config: RunConfig,
  visitedUrls: Set<string>,
  recordCount: number
): string {
  const fieldList = Object.entries(config.schemaDef.fieldDescriptions)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  const seedSection = config.seedUrls?.length
    ? `\n\nStart by scraping these URLs before running any searches:\n${config.seedUrls.map((u) => `  ${u}`).join("\n")}`
    : "";

  const visitedSection =
    visitedUrls.size > 0
      ? `\n\nAlready scraped — do not revisit:\n${[...visitedUrls].map((u) => `  ${u}`).join("\n")}`
      : "";

  return `You are a structured data extraction agent. Your task is to build a COMPLETE, accurate dataset about: "${config.topic}". You must continue working until the dataset is fully complete — do not stop early.

## Target schema
${fieldList}

## Workflow — follow exactly
1. Plan: briefly note which queries you will run.
2. Search: call search_google for 2-3 queries from different angles (you may call multiple in parallel).
3. Scrape comparison portals first (moneyland.ch, comparis.ch, finpension.ch, evaluno.ch, etc.) — they list many providers on one page.
4. After EACH scrape_url, immediately call extract_structured_data with all records you found (pass empty array if none — still required). For comparison site pages: extract every provider record listed; leave the url field blank if you only have a comparison site URL.
5. From comparison pages, collect all links to individual provider/bank pages and scrape those too — official pages have authoritative data and you should prefer their records.
6. Keep searching and scraping until all referenced providers have been visited. Most topics have 20–50+ providers.
7. Only call finish after exhausting all known provider pages AND running follow-up searches to catch missed ones.

## Rules
- Always call tools — never describe what you would do without calling a tool
- Call extract_structured_data after EVERY scrape_url call — no exceptions, even for 0 records
- You may call multiple search_google in parallel; for scrape_url try to batch multiple at once too
- Never scrape the same URL twice
- Only save records where all required fields are clearly stated — no guessing
- Records collected so far: ${recordCount}${seedSection}${visitedSection}`;
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
      const isRetryable =
        err instanceof Error && /5\d\d|rate.?limit|overloaded/i.test(err.message);
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = attempt * 5000;
      log("log", {
        message: `API error (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${(err as Error).message}`,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

const CONTEXT_WINDOW = 4;

function trimMessages(messages: OpenAI.ChatCompletionMessageParam[]): void {
  // messages[0] is the initial user prompt; after that: [assistant+tool_calls, tool, tool, ...]
  // We MUST trim at turn boundaries — never split an assistant message from its tool results,
  // because OpenAI requires ALL tool_calls to have corresponding tool results in the same turn.
  if (messages.length <= 1) return;

  // Parse turns: each turn starts with an assistant message and includes all following tool messages
  const turnStarts: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "assistant") turnStarts.push(i);
  }

  if (turnStarts.length <= CONTEXT_WINDOW) return; // nothing to trim

  // Drop oldest turns, keep last CONTEXT_WINDOW
  const firstKept = turnStarts[turnStarts.length - CONTEXT_WINDOW];
  messages.splice(1, firstKept - 1);
}

export async function runAgentOpenAI(
  config: RunConfig,
  llmClient: OpenAILLMClient,
  serpApiKey: string,
  crawl4aiBase: string,
  onRecords?: (records: ExtractedRecord[]) => Promise<void>,
  emit?: EmitFn,
  signal?: AbortSignal
): Promise<ExtractedRecord[]> {
  const log = makeLog(emit);
  const openai = llmClient.rawClient;
  const tools = buildTools(config.schemaDef);
  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  const visitedUrls = new Set<string>();
  const urlDepth = new Map<string, number>();
  const allRecords: ExtractedRecord[] = [];

  messages.push({
    role: "user",
    content: `Research topic: "${config.topic}"\n\nCollect all available data matching the schema. Be thorough.`,
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

    const response = await withRetry(
      () =>
        openai.chat.completions.create({
          model: llmClient.agentModel,
          max_completion_tokens: 8192,
          messages: [
            {
              role: "system",
              content: buildSystemPrompt(config, visitedUrls, allRecords.length),
            },
            ...messages,
          ],
          tools,
          tool_choice: "required",
        }),
      log
    );

    log("tokens", { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 });

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // Log any reasoning text
    if (assistantMessage.content?.trim()) {
      log("agent", { message: assistantMessage.content.trim().slice(0, 300) });
    }

    // Add assistant turn to history
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    });

    // Model decided to stop without calling a tool
    if (choice.finish_reason === "stop" || !assistantMessage.tool_calls?.length) {
      log("log", { message: "Agent finished (no tool call)" });
      break;
    }

    const toolCalls = assistantMessage.tool_calls?.filter((tc) => tc.type === "function") ?? [];

    // Handle finish before parallel dispatch
    const finishCall = toolCalls.find((tc) => tc.function.name === "finish");
    if (finishCall) {
      const minScrapes = Math.min(25, Math.floor(config.maxIterations * 0.8));
      const tooFewScrapes = visitedUrls.size < minScrapes;
      const tooFewRecords = allRecords.length < 5 && visitedUrls.size >= 5;
      // Check if there are providers only seen on comparison sites with no official record
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
      if ((tooFewScrapes || tooFewRecords || hasUnvisitedProviders) && notNearEnd) {
        const reason = tooFewRecords
          ? `only ${allRecords.length} records found so far`
          : hasUnvisitedProviders
          ? `these providers only have comparison data, no official pages scraped yet: ${uniqueComparisonOnly.join(", ")}`
          : `only ${visitedUrls.size} pages scraped out of expected ~${minScrapes}`;
        log("log", { message: `Finish rejected (${reason}). Continuing…` });
        messages.push({
          role: "tool",
          tool_call_id: finishCall.id,
          content: `Not done yet — ${reason}. Search for and scrape the official pages for these providers.`,
        });
        continue;
      }

      const input = JSON.parse(finishCall.function.arguments || "{}") as ToolInput;
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
      messages.push({ role: "tool", tool_call_id: finishCall.id, content: "Done." });
      return allRecords;
    }

    // Mark scrape URLs as visited upfront to prevent duplicate concurrent scrapes
    const newScrapeUrls = new Set<string>();
    for (const tc of toolCalls) {
      if (tc.function.name === "scrape_url") {
        const input = JSON.parse(tc.function.arguments || "{}") as ToolInput;
        const url = input.url!;
        if (!visitedUrls.has(url)) {
          visitedUrls.add(url);
          newScrapeUrls.add(url);
        }
      }
    }

    // Execute all tool calls concurrently
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => {
        const toolName = tc.function.name as ToolName;
        const input = JSON.parse(tc.function.arguments || "{}") as ToolInput;
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
              resultContent = JSON.stringify({ error: "Already scraped." });
            } else {
              const depth = urlDepth.get(url) ?? 0;
              if (depth > config.maxDepth) {
                resultContent = JSON.stringify({ error: `Max depth ${config.maxDepth} reached.` });
              } else {
                log("scrape_start", { url, depth });
                const result = await scrapeUrl(url, crawl4aiBase);
                for (const link of result.links) {
                  if (!urlDepth.has(link.url)) urlDepth.set(link.url, depth + 1);
                }
                resultContent = JSON.stringify({
                  markdown: result.markdown.slice(0, 50000),
                  links: result.links.slice(0, 150).map((l) => l.url),
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
          if (toolName === "scrape_url" && input.url) {
            log("scrape_done", { url: input.url, error: true });
          }
          log("error", { tool: toolName, message: msg });
          resultContent = JSON.stringify({ error: msg });
        }

        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: resultContent,
        };
      })
    );

    messages.push(...toolResults);
    trimMessages(messages);
  }

  log("log", { message: `Agent loop ended. ${allRecords.length} records collected.` });
  return allRecords;
}

function makeLog(emit?: EmitFn) {
  return (type: string, payload: Record<string, unknown>) => {
    emit?.(type, payload);
    const msg = payload.message ?? formatPayload(type, payload);
    process.stderr.write(`[scrappy] ${msg}\n`);
  };
}

function formatPayload(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "search":       return `[search] ${p.query}`;
    case "search_done":  return `  → ${p.count} URLs`;
    case "scrape_start": return `[scrape] depth=${p.depth} ${p.url}`;
    case "scrape_done":  return `  → ${p.chars} chars, ${p.links} links`;
    case "extract":      return `[extract] +${p.count} records from ${p.url} (total: ${p.total})`;
    case "finish":       return `[finish] ${p.total} total records`;
    case "error":        return `[error] ${p.tool}: ${p.message}`;
    case "agent":        return `[agent] ${p.message}`;
    case "iter_state":   return `[iter] ${p.iteration}/${p.maxIterations} · ${p.visitedCount} scraped · ${p.recordCount} records`;
    default:             return JSON.stringify(p);
  }
}
