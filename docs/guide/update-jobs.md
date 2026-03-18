# Update Jobs

An update job re-scrapes source pages and refreshes the tracked fields in an existing dataset — without running a full re-index.

## How it works

Records are first split into two buckets:

**Official rows** — the stored URL points to a provider's own domain:
→ Enter the 3-stage pipeline directly

**Comparison-only rows** — the stored URL points to a comparison site (comparis.ch, moneyland.ch, etc.):
→ A Google SERP search is run first to find the official page, then enters the pipeline

### Stage 1 — BM25 scrape

Crawl4AI fetches the page using `filter_type: "bm25"`, passing the tracked field descriptions as the query. Returns only the sections of the page relevant to those terms — typically 1–5k chars instead of 30k+. Claude Haiku extracts the values. If they're found, the record is updated and the pipeline stops here.

### Stage 2 — Full crawl

If BM25 returned nothing useful, the full page is fetched without any content filter. This helps with:
- Pages where values are hidden in JS-rendered widgets
- Custom HTML elements (web components) that markdown extraction misses — the full HTML is scanned for all `href` attributes including those in non-standard tags

Any new links discovered in stage 2 are added to the candidate pool for stage 3. Claude Haiku tries again on the full-page markdown.

### Stage 3 — Follow promising links

If still no result, outbound links from the page are scored by relevance and the best candidates are scraped individually:

| Signal | Score |
|---|---|
| `.pdf` extension | +3 |
| URL path contains relevant keywords (`zins`, `rate`, `tarif`, `prix`, `rendement`, `kondition`, `preis`) | +2 |
| Anchor text contains relevant keywords | +2 |
| No path-level keyword signal | ×0.5 |

The top 5 scoring links are tried. PDFs are downloaded and parsed directly (with TLS fallback for Swiss CA certificates). HTML pages are scraped via Crawl4AI.

## URL routing

The routing condition checks the **stored URL**, not the `_dataSource` field. A record tagged `_dataSource: "comparison"` because it was found on a comparison portal — but whose URL field contains the official provider URL — is scraped directly, not sent to SERP search.

After a successful update, `_dataSource` is set to `"official"`.

## Value comparison

Extracted values are compared **numerically** where possible to avoid false positives from formatting differences:

| Old | New | Result |
|---|---|---|
| `29.90` | `CHF 29.90/month` | unchanged |
| `29.90` | `39.90` | **changed** |
| `0.45%` | `0.45% p. a.` | unchanged |

Changed rows get a new `_lastUpdated` timestamp.

## Parameters

| Parameter | Description |
|---|---|
| `input` | Dataset name to update |
| `schema` | Schema ID (from UI) or path to TypeScript schema file |
| `filter` | Optional string — only update rows where any dedupeKey field contains this value |

## UI

Start an update job from the **Scrape → Update** tab. Select the dataset, schema, and an optional filter, then click **↻ Run**. The monitor view shows updated rows in real time (green = value changed).

## Requirements

- `SERPAPI_KEY` must be set to process comparison-only rows (rows whose URL points to a comparison domain)
- Rows with a comparison URL and no SERPAPI_KEY are skipped with a log message
