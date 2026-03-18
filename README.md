# Scrappy

An AI-powered web scraping and data extraction pipeline. You define a data schema, describe a research topic, and Scrappy deploys a Claude-powered agent that searches the web, scrapes pages, and extracts structured records — with a real-time monitoring UI.

---

## How it works

Scrappy has two modes: **Index** (discover and extract new data) and **Update** (refresh existing data from official sources).

### Index — Discovery

The agent loop runs until it has exhausted available sources:

1. Claude generates targeted search queries for the topic
2. SerpAPI returns relevant URLs (comparison portals, official provider pages, etc.)
3. Each URL is scraped via [Crawl4AI](https://crawl4ai.com) — JS-rendered, returned as clean markdown
4. Claude reads the markdown and calls `extract_structured_data` with the found records
5. From comparison sites, Claude also follows links to official provider pages and scrapes those too
6. Records are saved to SQLite incrementally after every scrape
7. When Claude is satisfied, it calls `finish`

Records are tagged `_dataSource: "comparison"` or `"official"`. If the same record is found on both a comparison site and the provider's own page, the official version wins.

### Update — Data refresh

Used to keep existing records up to date without re-running a full index:

1. Records with a stored official URL are scraped directly
2. Records with only a comparison URL trigger a Google search to find the official page first
3. Crawl4AI fetches the page using BM25 keyword filtering (returns only the relevant content sections)
4. Claude Haiku extracts the tracked fields from the filtered markdown
5. Values are compared numerically (avoids false positives from formatting differences like `"0.45%"` vs `"0.45% p. a."`)
6. Changed rows are updated in the database with a new `_lastUpdated` timestamp

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser UI                        │
│     Svelte 5 · real-time SSE · Monitor + Scrape screens  │
└────────────────────────┬────────────────────────────────┘
                         │ REST + SSE
┌────────────────────────▼────────────────────────────────┐
│                    Fastify Server                         │
│  /jobs  /schemas  /outputs  /settings  /jobs/:id/stream  │
└──────────┬─────────────────────────┬────────────────────┘
           │                         │
┌──────────▼──────────┐   ┌─────────▼──────────────┐
│    Agent Loop        │   │    Update Command        │
│  loop.ts             │   │  update.ts               │
│  Claude Opus 4.6     │   │  Claude Haiku            │
│  tool_use pattern    │   │  BM25-filtered scrapes   │
└──────────┬──────────┘   └──────────┬───────────────┘
           │                         │
┌──────────▼─────────────────────────▼───────────────────┐
│                       Tools                              │
│  SerpAPI (search)  ·  Crawl4AI (scrape)  ·  SQLite      │
└────────────────────────────────────────────────────────-┘
```

### Key files

```
src/
├── index.ts              CLI entry point (index / update commands)
├── agent/
│   ├── loop.ts           Agent loop with tool orchestration
│   └── llm-client.ts     LLM abstraction (Anthropic, OpenAI, ZordMind)
├── commands/
│   └── update.ts         Update / data refresh command
├── tools/
│   ├── crawl.ts          Crawl4AI HTTP client
│   ├── serp.ts           SerpAPI Google search
│   ├── records.ts        SQLite CRUD + deduplication
│   └── csv.ts            CSV export
└── server/
    ├── index.ts          Fastify REST API
    ├── jobs.ts           Job lifecycle + SSE streaming
    ├── runner.ts         Execute jobs with event emission
    ├── db.ts             SQLite schema and init
    ├── settings.ts       LLM provider config
    └── schema-store.ts   Schema CRUD

schemas/
└── 3a-konto.ts           Example: Swiss Säule 3a accounts

ui/
└── src/
    ├── App.svelte         Screen router (Monitor / Scrape)
    ├── stores/
    │   ├── jobs.svelte.ts     Global job list
    │   └── dashboard.svelte.ts  Live agent state + token tracking
    └── components/
        ├── MonitorScreen.svelte  Agent activity dashboard
        ├── ScrapeScreen.svelte   Forms + datasets
        ├── Header.svelte         Running job indicator
        └── modals/
            ├── SettingsModal.svelte  LLM provider + model config
            └── SchemaModal.svelte    Schema editor
```

---

## Schemas

A schema defines what data to extract and how. Each schema is a TypeScript file that exports a `SchemaDefinition`:

```typescript
// schemas/my-schema.ts
import { z } from "zod";
import type { SchemaDefinition } from "../src/types.js";

const schemaDef: SchemaDefinition = {
  schema: z.object({
    productName: z.string(),
    providerName: z.string(),
    interestRate: z.string(),
    url: z.string().optional(),
  }),
  fieldDescriptions: {
    productName: "Full product name as shown by the provider",
    providerName: "Name of the bank or institution",
    interestRate: "Annual interest rate (e.g. '0.75%' or '0.39%–0.45%' for tiered)",
    url: "Direct URL to the official product page",
  },
  dedupeKey: ["productName", "providerName"],
  urlField: "url",
  rateFields: ["interestRate"],
  namingRules: [
    "providerName: use the common short name, no legal suffixes (e.g. 'UBS' not 'UBS AG')",
  ],
};

export default schemaDef;
```

Schemas can also be created and edited via the UI.

---

## Setup

### Requirements

- Node.js 22+
- A running [Crawl4AI](https://crawl4ai.com) instance
- API keys: Anthropic (required), SerpAPI (required for search), OpenAI (optional)

### Install

```bash
npm install
cd ui && npm install && npm run build && cd ..
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
SERPAPI_KEY=your-serpapi-key
CRAWL4AI_BASE=http://localhost:11235   # or your hosted Crawl4AI URL
PORT=3000
```

---

## Running

### Web UI (recommended)

```bash
npm run server
```

Then open [http://localhost:3000](http://localhost:3000).

From the **Scrape** screen:
1. Create or select a schema
2. Enter a topic and start an Index job
3. Switch to the **Monitor** screen to watch the agent work in real time

To refresh existing data: go to Scrape → select a dataset → run Update.

### CLI

```bash
# Index: discover new data
npm start -- index \
  --topic "Swiss savings accounts" \
  --schema schemas/3a-konto.ts \
  --output 3a-konto \
  --max-iterations 40

# Update: refresh data in existing dataset
npm start -- update \
  --input 3a-konto \
  --schema schemas/3a-konto.ts
```

---

## LLM Providers

Scrappy supports multiple LLM backends. Configure in the UI under Settings, or in `data/settings.json`.

| Provider | Agent model | Extract model |
|---|---|---|
| **Anthropic** (default) | claude-opus-4-6 | claude-haiku-4-5-20251001 |
| **OpenAI** | gpt-5.4 | gpt-5.4-mini |
| **ZordMind** | self-hosted | same model |

The agent loop uses the heavier model (tool-use, reasoning). The update command uses the lightweight extract model (simple JSON extraction from a page snippet).

---

## Data flow in detail

### Deduplication

Records are deduplicated at write time:

1. **Primary key** — normalized `dedupeKey` fields (e.g. `productName + providerName`)
2. **Source priority** — if the same key exists from both a comparison site and an official page, the official version is kept and comparison data fills in any blank fields

### Record metadata

Every record gets two system fields automatically:

- `_dataSource`: `"comparison"` (found on a comparison portal) or `"official"` (scraped from provider's own site)
- `_lastUpdated`: ISO date of last successful update

### Token tracking

The UI shows a running token counter in the stats bar during Index and Update jobs. Hover the count to see the input/output split. This helps estimate API costs before a full run completes.

---

## Database

All data is stored in `data/scrappy.db` (SQLite):

- `records` — extracted data rows, one per record per dataset
- `jobs` — job history with status and parameters
- `events` — structured event log per job (used for replaying the monitor view)
- `schemas` — schema definitions created via the UI

CSV exports live in `output/` and can be downloaded from the UI or served directly via `/outputs/:dataset`.
