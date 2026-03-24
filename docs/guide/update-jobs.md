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

If still no result, outbound links from the page are scored by relevance and the best candidates are scraped individually.

**Three-tier keyword matching** — links are scored using three groups with different weights:

| Signal | Score |
|---|---|
| `.pdf` extension | +3 |
| URL path contains a **tracked field** keyword (e.g. `zinssatz` → `zinssaetze.html`) | +4 |
| URL path matches a **generic detail/pricing pattern** (e.g. `konditionen`, `tarife`, `specs`, `pricing`, `taux`) | +3 |
| Anchor text contains a tracked field keyword | +3 |
| URL path contains a general schema keyword (field names, description words) | +2 |
| Anchor text contains a general schema keyword | +2 |
| No path-level keyword signal at all | ×0.5 (anchor-text only links are weaker) |

Tracked field keywords (from `rateFields`) score highest because they name the exact data being sought. Generic detail/pricing path patterns (tier 2) catch common product-detail URL segments across all domains and languages — these are scored higher than general schema keywords to surface `konditionen`, `specs`, or `pricing` pages even when those words don't appear in the schema definition. Keywords are normalized before matching (German umlauts and digraph expansions are collapsed) so `zinssatz` matches `zinssaetze` in a URL.

**Umlaut normalization** — URL paths and anchor text are normalized before matching: German umlaut characters (ä→a, ö→o, ü→u) and their digraph expansions (ae→a, oe→o, ue→u) are collapsed. This lets the keyword `zinssatz` match `zinssaetze` in a URL path.

**Non-content links are excluded** — two categories are filtered before scoring:
- Media/font files: `.svg`, `.png`, `.jpg`, `.gif`, `.webp`, `.ico`, `.woff`, `.ttf`, `.zip`, `.xml`, `.json`
- Login/portal paths: `/login`, `/ebanking`, `/e-banking`, `/auth`, `/secure`, `/portal`, `/signin`, `/mobilebanking`, `/onlinebanking` — these paths appear on nearly every bank site and never contain rate data

The top **3 scoring links** are tried in a normal update. Each HTML page is also scanned for PDFs one level deeper (up to 5 per page). PDFs are downloaded and parsed directly with TLS fallback for Swiss CA certificates.

### Deep search

A per-row action in the records table. Runs the same 3-stage pipeline with expanded limits:

- Up to **10 candidate links** followed (instead of 3)
- Up to **10 PDFs** scanned per linked page (instead of 5)

Use this when a regular update fails to find a value for a specific row.

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
| `deepSearch` | Boolean — expand link candidate limit to 10/10 (see above) |

## UI

In the Datasets screen, click `↻` next to any dataset in the sidebar. The Update panel opens with the schema auto-selected from the most recent job that used that dataset. Set an optional filter and click **↻ Run**. The monitor view shows updated rows in real time (green = value changed). Click any updated row in the monitor to jump back to that dataset.

To deep search a specific row, open the row action menu (⋯) in the records table and choose **⌕ Deep search**. This starts a single-record update job with the expanded limits.

## Requirements

- `SERPAPI_KEY` must be set to process comparison-only rows (rows whose URL points to a comparison domain)
- Rows with a comparison URL and no SERPAPI_KEY are skipped with a log message
