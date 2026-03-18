# What is Scrappy?

Scrappy is an AI-powered research and scraping pipeline. You define a data schema and a topic — Scrappy deploys a Claude agent that searches the web, scrapes pages, and extracts structured records into a SQLite-backed dataset.

It's built for **comparison research**: any domain where you want to collect structured data about a set of providers, products, or services across multiple sources — and keep that data fresh over time.

**Example use cases:**
- Pension fund providers and their investment strategies
- Telecom plans and pricing across carriers
- Software tools and their feature sets / pricing tiers
- Mortgage rates across banks
- Electric vehicle models and specs

## Two modes

### Index — Discovery

The agent loop runs until it has exhausted available sources:

1. Claude generates targeted search queries for your topic
2. SerpAPI returns relevant URLs (comparison portals, official provider pages, etc.)
3. Each URL is scraped via Crawl4AI — JS-rendered, returned as clean markdown
4. Claude reads the markdown and saves extracted records
5. From comparison sites, Claude also follows links to official provider pages
6. Records are saved incrementally after every scrape
7. When Claude is satisfied, it calls `finish`

Records are tagged `_dataSource: "comparison"` or `"official"`. If the same record is found on both a comparison site and the provider's own page, the official version wins.

### Update — Keep data fresh

Keeps existing records up to date without a full re-index. Each record goes through a 3-stage pipeline:

**Stage 1 — BM25 scrape.** Crawl4AI fetches the page with BM25 filtering, returning only sections relevant to your tracked fields. Claude Haiku extracts the values. If they're found, done.

**Stage 2 — Full crawl.** If BM25 returned nothing useful, the full page is fetched (no filter). This discovers additional links from JS-rendered content and custom HTML elements (e.g. web components). Claude Haiku tries again.

**Stage 3 — Follow promising links.** If still no result, outbound links are scored by relevance (PDFs score highest, URL path keywords and anchor text add to the score). The top candidates are scraped individually. PDFs are downloaded and parsed directly.

Records with a comparison-site URL first go through a Google SERP search to find the official provider URL before entering the pipeline.

Values are compared **numerically** where possible to avoid false positives from formatting differences — `0.45%` and `0.45% p.a.` are treated as equal.

## How it fits together

```
Topic + Schema
      │
      ▼
  Agent Loop (Claude Opus)
  ├── search_google → SerpAPI
  ├── scrape_url → Crawl4AI
  ├── extract_structured_data → saved to SQLite
  └── finish
      │
      ▼
  Dataset (SQLite + CSV export)
      │
      ▼
  Update Command (Claude Haiku)
  ├── Stage 1: /md BM25 filter
  ├── Stage 2: /crawl full page + HTML link extraction
  └── Stage 3: follow scored links / PDFs
```
