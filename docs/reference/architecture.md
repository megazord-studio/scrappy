# Architecture

## Overview

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
│  Claude Opus 4.6     │   │  Claude Haiku            │
│  tool_use pattern    │   │  BM25-filtered scrapes   │
└──────────┬──────────┘   └──────────┬───────────────┘
           │                         │
┌──────────▼─────────────────────────▼───────────────────┐
│                       Tools                              │
│  SerpAPI (search)  ·  Crawl4AI (scrape)  ·  SQLite      │
└─────────────────────────────────────────────────────────┘
```

## Key files

```
src/
├── index.ts              CLI entry point
├── agent/
│   ├── loop.ts           Agent loop + tool definitions + system prompt
│   └── llm-client.ts     LLM abstraction (Anthropic / OpenAI / ZordMind)
├── commands/
│   └── update.ts         Update — BM25 scrape + Haiku extraction
├── tools/
│   ├── crawl.ts          Crawl4AI /crawl client (index agent)
│   ├── serp.ts           SerpAPI Google search
│   ├── records.ts        SQLite CRUD + deduplication
│   └── csv.ts            CSV export
└── server/
    ├── index.ts          Fastify REST API
    ├── jobs.ts           Job lifecycle + SSE event streaming
    ├── runner.ts         Execute index/update jobs
    ├── db.ts             SQLite init and queries
    ├── settings.ts       LLM provider config (data/settings.json)
    └── schema-store.ts   Schema CRUD
```

## Database

SQLite at `data/scrappy.db`:

| Table | Contents |
|---|---|
| `records` | Extracted rows, one per record per dataset |
| `jobs` | Job history — type, status, params, timestamps |
| `events` | Structured event log per job (replayed in monitor view) |
| `schemas` | Schema definitions created via the UI |

## Event streaming

Jobs emit typed events as they run. These are:
1. Written to the `events` table (for replay when loading a past job)
2. Broadcast over SSE to all connected clients at `/jobs/:id/stream`

The UI's monitor view processes the same event types whether replaying history or watching live.

## Deduplication

Records are deduplicated at write time:

1. **Primary key** — normalized `dedupeKey` fields
2. **Source priority** — official beats comparison; comparison fields fill blank official fields

## Crawl4AI config

The index agent uses a minimal crawler config (`delay_before_return_html: 8s`, scroll JS, no content filtering) to ensure JS-heavy pages render fully. Extra options like `excluded_tags` or `word_count_threshold` have caused empty responses on some sites.

The update command uses two Crawl4AI modes:

- **`/md` with BM25** (stage 1) — returns only page sections relevant to the tracked field descriptions; typically 1–5k chars
- **`/crawl`** (stages 2 and 3) — full HTML response; the raw HTML is scanned with a regex for all `href` attributes, including those in custom web components that markdown conversion would miss

PDF links discovered in stages 2/3 are fetched directly via `https.get` (not Crawl4AI), with a TLS fallback (`rejectUnauthorized: false`) to handle Swiss CA certificates not in the Node.js trust store.
