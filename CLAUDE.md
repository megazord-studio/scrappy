# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload on server + UI)
npm run dev

# Production server only (serves built UI from /public)
npm run server

# Build UI for production
npm run ui:build

# Run tests
node --test tests/dedup.test.ts

# Type-check UI
cd ui && npm run check

# CLI usage
npm start -- index --topic "..." --schema schemas/3a-konto.ts --output my-dataset
npm start -- update --input my-dataset --schema schemas/3a-konto.ts
```

No lint step is configured. There is no test runner script — tests use Node's built-in `node:test` module directly.

## Architecture

### Two execution paths

**Index (discovery):** `src/agent/loop.ts` runs a Claude tool-use loop with four tools: `search_google`, `scrape_url`, `extract_structured_data`, `finish`. The agent searches, scrapes, extracts records into SQLite, and calls `finish` when done. Records are written incrementally after each extraction via `src/tools/records.ts`.

**Update (refresh):** `src/commands/update.ts` takes an existing dataset and re-scrapes each record's URL through a 3-stage fallback pipeline: BM25-filtered `/md` endpoint → full `/crawl` → scored outbound links. Comparison-site rows go through a SERP lookup first to find the official URL.

Both paths are triggered via the Fastify server (`src/server/runner.ts`) which calls `getLLMClient()` to get the configured LLM and spawns the job. Jobs stream typed events over SSE (`/jobs/:id/stream`) that are simultaneously written to the `events` table for replay.

### LLM abstraction

`src/agent/llm-client.ts` exports `LLMClient` — a thin wrapper around the Anthropic SDK interface that Anthropic, OpenAI, and ZordMind all conform to. OpenAI and ZordMind clients translate Anthropic-style `messages.create()` calls (with tool_use/tool_result blocks) into their own format. This means `loop.ts` and `update.ts` only ever speak the Anthropic message format.

Provider/model selection is persisted in `data/settings.json` and read at job-start time via `src/server/settings.ts`.

### Deduplication

`src/tools/records.ts` deduplicates at write time using two keys:
1. **Primary key** — normalized `dedupeKey` fields (case-insensitive, legal suffixes like "AG"/"SA" stripped from bank names)
2. **URL+rate key** — `normalizedBank|normalizedUrl|rates` — catches same product found via differently-named entry on a comparison site

Official source beats comparison: if the same key exists, the official record is kept and any blank fields are filled from comparison data.

### Schema definition

A schema (`SchemaDefinition` in `src/types.ts`) is the central config object passed through the entire pipeline:
- `schema` — Zod object defining fields and types
- `fieldDescriptions` — passed verbatim into the LLM extraction prompt
- `dedupeKey` — fields used for deduplication
- `urlField` — which field holds the URL to scrape during updates
- `trackedFields` — fields monitored for changes during updates
- `namingRules` — optional LLM instructions for normalization

Schemas can be TypeScript files in `schemas/` or created via the UI and stored in the `schemas` SQLite table.

### UI

Svelte 5 (`$state`, `$derived`, `$effect`, `$props` runes — no Svelte stores). Built separately in `ui/`, served statically by Fastify in production. In dev, Vite runs on `:5173` and proxies `/jobs`, `/schemas`, `/outputs`, `/settings`, `/chat` to Fastify on `:3000` — all API paths must be listed in `ui/vite.config.ts`.

Key stores: `dashboard.svelte.ts` holds live agent state (updated by SSE events), `jobs.svelte.ts` holds the job list. `ScrapeScreen` remounts fully on screen switch (it's in an `{:else}` block), so `$state(initialProp)` initialization is reliable without `$effect`.

### Data locations

- `data/scrappy.db` — SQLite database (WAL mode)
- `data/settings.json` — LLM provider config
- `output/` — CSV exports
- `public/` — built UI assets (gitignored output of `npm run ui:build`)
