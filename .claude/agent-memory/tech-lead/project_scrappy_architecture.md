---
name: scrappy_architecture
description: Scrappy codebase architecture, tech stack, and key patterns observed during review
type: project
---

Svelte 5 + Node.js/TypeScript scraper app. Two execution paths: index (discovery via Claude/OpenAI agent loop) and update (re-scrape existing dataset). SQLite backend (WAL mode). Fastify server on :3000, Vite dev server on :5173 proxying to it.

**Why:** Context for all future reviews and feature work on this repo.
**How to apply:** Use this as the base mental model when reviewing PRs, answering architecture questions, or suggesting changes.

## Key architectural facts

- Agent loops: `src/agent/loop.ts` (Anthropic) and `src/agent/openai-loop.ts` (OpenAI) — near-identical implementations, NOT shared
- LLM abstraction: `src/agent/llm-client.ts` wraps Anthropic SDK interface; OpenAI/ZordMind clients translate to it
- State management: Svelte 5 runes ($state/$derived/$effect), class-based stores in `ui/src/stores/`
  - `dashStore` (DashboardStore) — SSE-driven live job state, event processing, timers
  - `jobsStore` (JobsStore) — job list, polling
- API layer: `ui/src/lib/api.ts` — clean centralized fetch wrapper; ONE raw `fetch` bypass found in ScrapeScreen (deleteSchema)
- Two parallel screens with overlapping concerns: `ScrapeScreen.svelte` (dark, code-editor style) and `DatasetsScreen.svelte` (light card UI) — appear to be old vs new versions of same feature; DatasetsScreen may be legacy
- `cellClass()` function duplicated between `RecordsTab.svelte` and `DatasetsScreen.svelte`
- Source badge CSS (`.source-badge`, `.source-official`, `.source-comparison`) duplicated between `RecordsTab.svelte` and `DatasetsScreen.svelte`
- `App.svelte` polls `jobsStore.refresh()` AND `getOutputs()` every 3s; dashStore also has its own `recordsTimer` interval
- `dashStore.navTarget` — a string written by one component and read by `App.svelte` via $effect to trigger navigation; a navigation side-channel through store state
- `runner.ts` calls `makeLLMClient()` twice in `runIndexJob` (lines 75 and 79 both call it); and calls `readSettings()` twice
- `DashboardStore.elapsed` is a `$derived` but requires a `_elapsedTick` hack because `Date.now()` is not reactive — timer increments the tick to force recomputation
- `processEvent()` in dashStore does string matching on raw log messages (e.g. `msg.includes('following promising link')`) to translate internal server messages into UI copy — tight coupling between server log strings and UI display
- `Job.params` interface in `types.ts` is a catch-all with all optional fields — no discriminated union between index/update job params
- `maxIterations` is `number` on the server Job type but sent as `string` in the API body and parsed with `parseInt` in runner.ts — type mismatch crossing the API boundary
- No API error handling: most `api.ts` functions call `.then(r => r.json())` without checking `r.ok` — errors from the server silently return as JSON error objects or cause unhandled rejections
- No loading/error state for schema deletion in ScrapeScreen (just alert())
- `RecordsTab` does heavy client-side dedup grouping logic on every load — could be expensive on large datasets
- `buildKeyFields` heuristic in RecordsTab hardcodes `['kontoName', 'bankName']` — schema-specific logic leaked into a generic component
