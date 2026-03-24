# Index Jobs

An index job discovers and extracts new records for a dataset.

## Parameters

| Parameter | Description | Default |
|---|---|---|
| `topic` | Research topic passed to the agent | required |
| `schema` | Schema to use for extraction | required |
| `output` | Dataset name for results | required |
| `maxIterations` | Maximum agent loop iterations | 40 |
| `seedUrls` | URLs to scrape first, before any searches | — |

## Getting more results

### Increase maxIterations

Each iteration is one LLM decision round — more iterations means more searches and scrapes. Set it to 80–120 for thorough coverage.

### Add seedUrls to your schema

The biggest practical win. Point the agent directly at known comparison portals so it doesn't spend iterations finding them:

```typescript
const schemaDef: SchemaDefinition = {
  // ...
  seedUrls: [
    "https://www.comparis.ch/telecom/mobile/vergleich",
    "https://www.moneyland.ch/de/3a-konto-vergleich",
  ],
};
```

### Run multiple times on the same dataset

You can run the same index job repeatedly with different seed URLs or topic phrasings and point them all at the same output dataset. Deduplication runs at write time — new records are merged in, duplicates are skipped.

```bash
# First pass — comparison portals
npm start -- index --topic "Swiss mobile plans 2025" --schema schemas/mobile.ts --output mobile-plans

# Second pass — different angle, same dataset
npm start -- index --topic "Schweizer Mobilabo Vergleich Preise" --schema schemas/mobile.ts --output mobile-plans
```

## The agent loop

The index agent is a standard LLM tool-use loop. Each iteration sends the full conversation to the model, processes whatever tools it calls, feeds the results back, and repeats.

### What's in each message

The conversation has three layers:

**System prompt** (rebuilt each iteration) — contains the schema field list, the workflow instructions, the seed URLs to visit first, and two dynamic sections injected fresh every round:
- `Already scraped` — the full list of visited URLs, so the model never revisits a page
- `Records collected so far` — the running count

**Message history** — alternating assistant and user turns. The assistant turn contains the model's reasoning text and its tool call blocks. The user turn contains one `tool_result` block per tool call, with the actual data returned (search URLs, scraped markdown, extraction confirmations).

**Initial user message** — always `messages[0]`, never trimmed: `Research topic: "<topic>"\n\nFind all available data matching the schema.`

### Context window trimming

The conversation is trimmed after every iteration to stay within token limits. The initial user message is always kept. Only the last **4 assistant+user pairs** are retained — older iterations are dropped. The system prompt compensates by carrying the visited URL list and record count, so the model has enough context to continue without the full history.

### Parallel tool calls

The model can call multiple tools in a single response. All tool calls in one response are dispatched concurrently with `Promise.all`. To prevent duplicate scrapes within the same batch, URLs are marked as visited before dispatching — a second `scrape_url` for the same URL in the same iteration gets an immediate `"URL already scraped"` result.

### Depth tracking

Each URL gets a depth value: seed URLs and search results start at 0, links found on a scraped page inherit `depth + 1`. If the agent tries to scrape a URL that has exceeded `maxDepth`, it gets an error result instead. This prevents runaway link-following several hops from the original sources.

### How `finish` works — and when it's rejected

When the model calls `finish`, the loop checks three conditions before accepting it:

1. **Too few pages scraped** — must have visited at least `maxIterations × 0.8` URLs
2. **Too few records** — fewer than 5 records after visiting 5+ pages
3. **Unvisited comparison-only providers** — providers seen only on comparison sites with no official page scraped yet (up to 5 named in the rejection message)

If any condition fails and there are more than 3 iterations left, `finish` is rejected with a message explaining exactly what's missing. The model gets this as a `tool_result` and continues. If the agent is within 3 iterations of the limit, `finish` is accepted regardless.

### Stopping conditions

The loop ends when any of these occur:

| Condition | Notes |
|---|---|
| `finish` accepted | Normal completion |
| `stop_reason === "end_turn"` | Model stopped without calling a tool |
| Iteration limit reached | `maxIterations` exhausted |
| Job cancelled | `AbortSignal` fired from the UI cancel button |
| Unrecoverable API error | 5xx after 3 retries, or non-retryable error |

Retryable errors (5xx, rate limits, overloaded) are retried up to 3 times with 5s/10s/15s delays before the loop aborts.

## Record tagging

Every record gets:

- `_dataSource`: `"comparison"` or `"official"` — where it was extracted from
- `_lastUpdated`: ISO date of extraction

When the same record is found on both a comparison site and an official page, the official version is kept and any blank fields are filled from the comparison version.
