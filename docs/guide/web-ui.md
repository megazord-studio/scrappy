# Web UI

The web UI runs at `http://localhost:3000` after starting `npm run server`.

## Screens

### Monitor

Real-time view of whatever job is running (or last ran).

- **Action ticker** — shows the agent's current action. Pulsing green dot = running, dim = idle/done.
- **Stats bar** — iteration count, scraped pages, records found, elapsed time, token usage
- **Active Scrapes** — URLs currently being fetched
- **Search Queries** — Google searches the agent has made
- **Updated Rows** — rows refreshed by an update job (green = changed)
- **Completed Scrapes** — finished scrapes with char counts
- **Extractions** — records extracted per page
- **Jobs** — last 5 jobs, click to load any into the monitor view
- **Errors** — any tool errors during the run
- **Raw Log** — full event stream

### Scrape

Forms and data management.

- **Index** tab — start a new index job (topic, schema, output, iterations, seed URLs)
- **Update** tab — start an update job (dataset, schema, optional filter)
- **Datasets** — list of all datasets, with open/download/delete actions
- **Schemas** — create and edit schemas

## Token counter

The stats bar shows a running total of tokens used during the current job. Hover to see the input/output split. Useful for estimating costs mid-run.

## Settings

Click the gear icon in the header to configure:
- **Crawl4AI endpoint** — URL of your Crawl4AI instance (overrides the `CRAWL4AI_BASE` env var, takes effect immediately)
- **LLM provider** — Anthropic / OpenAI / ZordMind
- **Agent model and extract model** per provider
- **API key** — read-only display with copy button; required to trigger jobs via the REST API
- **Webhook URL** — called when a job finishes (POST with job result)
