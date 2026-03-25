import Database from "better-sqlite3";
import { readRecords, updateRecords } from "../tools/records.js";
import { scrapeUrl } from "../tools/crawl.js";
import { searchGoogle } from "../tools/serp.js";
import type { CsvRow, SchemaDefinition, EmitFn } from "../types.js";
import type { LLMClient } from "../agent/llm-client.js";
import { createRequire } from "module";
import https from "https";
import { isComparisonUrl } from "../lib/domains.js";
import type { PageLink } from "../types.js";
import {
  splitIdentifier,
  normalizeForMatch,
  buildSchemaKeywordRe,
  buildFieldValueRe,
  detailPageRe,
  rateLinkScore,
} from "../lib/link-score.js";
const _require = createRequire(import.meta.url);
const pdfParse = _require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

function extractNums(s: string): number[] {
  return [...s.matchAll(/(\d+[.,]\d+|\d+)/g)]
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => !isNaN(n));
}

function rateNumericallyEqual(a: string, b: string): boolean {
  const na = extractNums(a);
  const nb = extractNums(b);
  if (na.length === 0 && nb.length === 0) return a.trim() === b.trim();
  if (na.length !== nb.length) return false;
  return na.every((v, i) => Math.abs(v - nb[i]) < 0.001);
}

export async function runUpdate(
  dataset: string,
  schemaDef: SchemaDefinition,
  llmClient: LLMClient,
  crawl4aiBase: string,
  opts: { signal?: AbortSignal; filter?: string; recordIds?: number[]; emit?: EmitFn; db?: Database.Database; serpApiKey?: string; deepSearch?: boolean } = {}
): Promise<void> {
  const { signal, filter, recordIds, emit, serpApiKey, deepSearch } = opts;
  const log = (type: string, payload: Record<string, unknown>) => {
    emit?.(type, payload);
    const msg = payload.message ?? `[update] ${JSON.stringify(payload)}`;
    process.stderr.write(`[scrappy:update] ${msg}\n`);
  };

  const db: Database.Database = opts.db ?? (await import("../server/db.js")).db;
  let rows = readRecords(dataset, db);
  const urlField = schemaDef.urlField;

  if (recordIds?.length) {
    const idSet = new Set(recordIds);
    rows = rows.filter(r => idSet.has(Number(r["_id"])));
  }

  let officialRows: CsvRow[] = [];
  let comparisonRows: CsvRow[] = [];

  for (const r of rows) {
    const url = String(r[urlField] ?? "");
    if (!url.startsWith("http") || isComparisonUrl(url)) {
      comparisonRows.push(r);
    } else {
      officialRows.push(r);
    }
  }

  log("log", {
    message: `${officialRows.length} rows have official URLs, ${comparisonRows.length} are comparison-only`,
  });

  if (filter) {
    const q = filter.toLowerCase();
    const matches = (r: CsvRow) =>
      schemaDef.dedupeKey.some((k) => String(r[k] ?? "").toLowerCase().includes(q));
    officialRows = officialRows.filter(matches);
    comparisonRows = comparisonRows.filter(matches);
    log("log", {
      message: `Filter "${filter}" matched ${officialRows.length} official + ${comparisonRows.length} comparison rows`,
    });
  }

  log("update_start", { total: officialRows.length + comparisonRows.length });

  let updates = 0;
  let failed = 0;

  function extractLinks(markdown: string): PageLink[] {
    const seen = new Set<string>();
    const links: PageLink[] = [];
    const re = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdown)) !== null) {
      if (!seen.has(match[2])) { seen.add(match[2]); links.push({ text: match[1], url: match[2] }); }
    }
    return links;
  }

  const schemaKeywordRe = buildSchemaKeywordRe(schemaDef);
  const fieldValueRe = buildFieldValueRe(schemaDef);

  async function fetchPdf(url: string, referer?: string): Promise<string> {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/pdf,*/*;q=0.9",
      "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
    };
    if (referer) headers["Referer"] = referer;

    // Try built-in fetch first; fall back to https module with relaxed TLS
    // (some Swiss banks use CA certs not in Node's bundle but trusted by browsers)
    let buffer: Buffer;
    try {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`PDF fetch ${resp.status}`);
      buffer = Buffer.from(await resp.arrayBuffer());
    } catch {
      buffer = await new Promise<Buffer>((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.get(
          { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers, rejectUnauthorized: false },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
          }
        );
        req.setTimeout(30000, () => { req.destroy(); reject(new Error("PDF fetch timeout")); });
        req.on("error", reject);
      });
    }

    const data = await pdfParse(buffer);
    return data.text ?? "";
  }

  async function fetchMd(url: string, query: string): Promise<{ markdown: string; links: PageLink[] }> {
    const res = await fetch(`${crawl4aiBase}/md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        filter_type: "bm25",
        query,
        crawler_config: {
          type: "CrawlerRunConfig",
          delay_before_return_html: 8,
          page_timeout: 60000,
          js_code: "window.scrollTo(0, document.body.scrollHeight);",
        },
      }),
    });
    if (!res.ok) throw new Error(`crawl4ai /md error ${res.status}: ${await res.text()}`);
    const data = await res.json() as { markdown?: string; content?: string };
    const markdown = data.markdown ?? data.content ?? "";
    return { markdown, links: extractLinks(markdown) };
  }

  async function llmExtract(
    markdown: string,
    providerName: string,
    rateFieldDescriptions: string
  ): Promise<Record<string, unknown> | null> {
    if (!markdown) return null;
    const msg = await llmClient.messages.create({
      model: llmClient.extractModel,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Extract the following fields from this webpage content for "${providerName}". Return ONLY a JSON object with the field values, or null if not found.

Fields to extract:
${rateFieldDescriptions}

Webpage content:
${markdown}`,
      }],
    });
    if (msg.usage) log("tokens", { input: msg.usage.input_tokens, output: msg.usage.output_tokens });
    const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const extracted = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    for (const f of schemaDef.rateFields) {
      if (typeof extracted[f] === "string") {
        extracted[f] = (extracted[f] as string).replace(/,(\d)/g, ".$1").trim();
      }
    }
    const hasData = schemaDef.rateFields.some((f) => extracted[f] != null && extracted[f] !== "");
    return hasData ? extracted : null;
  }

  async function extractAndUpdate(row: CsvRow, url: string, providerName: string, isRootFallback = false): Promise<boolean> {
    const rateFieldDescriptions = schemaDef.rateFields
      .map((f) => `  - ${f}: ${schemaDef.fieldDescriptions[f] ?? f}`)
      .join("\n");
    const bm25Query = schemaDef.rateFields
      .map((f) => schemaDef.fieldDescriptions[f] ?? f)
      .join(" ");

    // Track URLs tried in this run to avoid redundant fetches across stages
    const triedUrls = new Set<string>();

    // eTLD+1 of the source URL — used to filter off-domain candidates (e.g. onetrust.com)
    const sourceDomain = (() => { try { const h = new URL(url).hostname.split("."); return h.slice(-2).join("."); } catch { return null; } })();

    // Deep search: the normal update already tried the stored URL with 3 candidates.
    // Skip straight to root domain so we get 10 fresh candidates from the homepage.
    if (deepSearch && !isRootFallback) {
      const rootUrl = (() => { try { return new URL(url).origin; } catch { return null; } })();
      const urlNoTrail = (() => { try { const u = new URL(url); u.hash = ""; u.search = ""; return u.href.replace(/\/$/, ""); } catch { return url; } })();
      if (rootUrl && rootUrl !== urlNoTrail) {
        log("log", { message: `${providerName}: deep search — starting from root domain ${rootUrl}` });
        return extractAndUpdate(row, rootUrl, providerName, true);
      }
    }

    // PDF fast path: skip Crawl4AI entirely, fetch + parse directly
    if (url.toLowerCase().endsWith(".pdf")) {
      try {
        log("scrape_start", { url, provider: providerName, method: "pdf" });
        const pdfReferer = (() => { try { return new URL(url).origin; } catch { return undefined; } })();
        const pdfText = await fetchPdf(url, pdfReferer);
        log("scrape_done", { url, provider: providerName, chars: pdfText.length, method: "pdf" });
        const extracted = await llmExtract(pdfText, providerName, rateFieldDescriptions);
        if (extracted) {
          const patch: CsvRow = { ...row };
          for (const f of schemaDef.rateFields) { if (extracted[f] != null) patch[f] = extracted[f]; }
          patch[urlField] = url;
          patch._dataSource = "official";
          patch._lastUpdated = new Date().toISOString().split("T")[0];
          const oldValue = schemaDef.rateFields.map((f) => `${f}=${row[f]}`).join(", ");
          const newValue = schemaDef.rateFields.map((f) => `${f}=${patch[f]}`).join(", ");
          const changed = schemaDef.rateFields.some((f) => !rateNumericallyEqual(String(row[f] ?? ""), String(patch[f] ?? "")));
          log("update_row", { provider: providerName, url, oldValue, newValue, changed });
          const { updated: u } = await updateRecords([patch], dataset, schemaDef, db);
          updates += u;
          return true;
        }
        log("log", { message: `${providerName}: PDF opened but no data found` });
      } catch (e) {
        log("log", { message: `${providerName}: PDF not accessible — falling back to root domain` });
      }
      // PDF inaccessible or no data: fall through to BM25/crawl pipeline on the root domain
      try { url = new URL(url).origin; } catch { /* keep url as-is */ }
    }

    // Stage 1: BM25-filtered /md
    log("scrape_start", { url, provider: providerName, method: "bm25" });
    let { markdown, links } = await fetchMd(url, bm25Query);
    log("scrape_done", { url, provider: providerName, chars: markdown.length, method: "bm25" });

    let extracted = await llmExtract(markdown, providerName, rateFieldDescriptions);

    // Stage 2: fallback to full /crawl when BM25 found no data
    // (full crawl exposes all page links including PDFs, which BM25 strips out)
    if (!extracted) {
      log("log", { message: `${providerName}: /md found no data (${markdown.length} chars), trying full /crawl` });
      try {
        const crawlResult = await scrapeUrl(url, crawl4aiBase);
        markdown = crawlResult.markdown;
        const seen = new Set(links.map(l => l.url));
        links = [...links, ...crawlResult.links.filter(l => !seen.has(l.url))];
        log("scrape_done", { url, provider: providerName, chars: markdown.length, method: "crawl" });
        extracted = await llmExtract(markdown, providerName, rateFieldDescriptions);
      } catch (e) {
        log("log", { message: `${providerName}: /crawl failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    // Stage 3: follow promising linked documents, sorted by relevance score
    if (!extracted) {
      // strip fragment from current url for comparison (anchor-only links add no new content)
      const currentBase = (() => { try { const u = new URL(url); u.hash = ""; return u.href; } catch { return url; } })();
      const candidates = links
        .map(l => ({ link: l, score: rateLinkScore(l, fieldValueRe, schemaKeywordRe) }))
        .filter(({ score, link }) => {
          if (score <= 0) return false;
          // skip links that are just fragments of the current page (same content, different scroll pos)
          try { const u = new URL(link.url); u.hash = ""; if (u.href === currentBase) return false; } catch {}
          // skip media/font/image files — they can never contain useful data
          if (/\.(svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|zip|xml|json)$/i.test(link.url)) return false;
          // skip login/portal/auth and editorial/blog pages — never contain product data
          // split by "/" and check if any segment starts with a known non-content keyword
          // (handles ebanking-mobilebanking, secureLogin, e-banking, etc.)
          try {
            const segments = new URL(link.url).pathname.toLowerCase().split("/");
            if (segments.some(s => /^(e-?banking|login|signin|sign-in|logout|auth|secure|portal|mobile-?banking|onlinebanking|news|blog|actualite|article|magazine|presse|points-de-vue|aktuell|medien|presse|comunicato|notizie)/.test(s))) return false;
          } catch {}
          // skip off-domain links (e.g. onetrust.com on allianz.ch) — third-party sites never have product data
          try { const h = new URL(link.url).hostname.split("."); if (sourceDomain && h.slice(-2).join(".") !== sourceDomain) return false; } catch {}
          // skip already-tried URLs
          if (triedUrls.has(link.url)) return false;

          return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, deepSearch ? 10 : 3)
        .map(({ link }) => link);

      for (const link of candidates) {
        const isPdf = link.url.toLowerCase().endsWith(".pdf");
        log("log", { message: `${providerName}: following promising link ${link.url}` });
        triedUrls.add(link.url);
        try {
          let linkMd: string;
          if (isPdf) {
            // PDFs: plain HTTP fetch with Referer so hotlink-protected servers allow access
            try {
              linkMd = await fetchPdf(link.url, link.url.replace(/\/[^/]*$/, "/"));
            } catch {
              const result = await scrapeUrl(link.url, crawl4aiBase);
              linkMd = result.markdown;
            }
            log("scrape_done", { url: link.url, provider: providerName, chars: linkMd.length, method: "pdf" });
            extracted = await llmExtract(linkMd, providerName, rateFieldDescriptions);
          } else {
            let pageLinks: PageLink[];
            ({ markdown: linkMd, links: pageLinks } = await fetchMd(link.url, bm25Query));
            log("scrape_done", { url: link.url, provider: providerName, chars: linkMd.length, method: "bm25" });
            extracted = await llmExtract(linkMd, providerName, rateFieldDescriptions);

            // One level deeper: BM25 may miss JS-rendered content (SPAs, web components).
            // Full crawl via Playwright renders the page — try extraction on that too,
            // then also scan for PDF links hidden in custom HTML elements.
            if (!extracted) {
              try {
                const crawlResult = await scrapeUrl(link.url, crawl4aiBase);
                const seen = new Set(pageLinks.map(l => l.url));
                pageLinks = [...pageLinks, ...crawlResult.links.filter(l => !seen.has(l.url))];
                // attempt extraction from the fully JS-rendered markdown
                extracted = await llmExtract(crawlResult.markdown, providerName, rateFieldDescriptions);
              } catch { /* ignore crawl errors, proceed with BM25 links */ }
              // score and prefer PDFs whose link text suggests rate content (e.g. "Die Zinssätze")
              const deepPdfs = pageLinks
                .filter(l => l.url.toLowerCase().endsWith(".pdf") && !triedUrls.has(l.url))
                .sort((a, b) => rateLinkScore(b, fieldValueRe, schemaKeywordRe) - rateLinkScore(a, fieldValueRe, schemaKeywordRe))
                .slice(0, deepSearch ? 10 : 5);
              for (const pdf of deepPdfs) {
                triedUrls.add(pdf.url);
                log("log", { message: `${providerName}: found PDF on ${link.url} → ${pdf.url}` });
                try {
                  const pdfText = await fetchPdf(pdf.url, link.url);
                  log("scrape_done", { url: pdf.url, provider: providerName, chars: pdfText.length, method: "pdf" });
                  extracted = await llmExtract(pdfText, providerName, rateFieldDescriptions);
                  if (extracted) { url = pdf.url; break; }
                } catch (e) {
                  log("log", { message: `${providerName}: PDF ${pdf.url} failed: ${e instanceof Error ? e.message : String(e)}` });
                }
              }
            }
          }
          if (extracted) {
            if (!url.endsWith(".pdf")) url = link.url;
            break;
          }
        } catch (e) {
          log("log", { message: `${providerName}: link ${link.url} failed: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
    }

    // Stage 4: if stored URL was a subpage and all attempts failed, fall back to the
    // root domain and re-run stages 1–3 from there. One level only (isRootFallback).
    if (!extracted && !isRootFallback) {
      const rootUrl = (() => { try { return new URL(url).origin; } catch { return null; } })();
      const urlNoTrail = (() => { try { const u = new URL(url); u.hash = ""; u.search = ""; return u.href.replace(/\/$/, ""); } catch { return url; } })();
      if (rootUrl && rootUrl !== urlNoTrail) {
        log("log", { message: `${providerName}: data not found on stored page — trying root domain ${rootUrl}` });
        return extractAndUpdate(row, rootUrl, providerName, true);
      }
    }

    if (!extracted) {
      log("error", { tool: "llm", message: `${providerName}: no data found after all attempts` });
      return false;
    }

    const patch: CsvRow = { ...row };
    for (const f of schemaDef.rateFields) {
      if (extracted[f] != null) patch[f] = extracted[f];
    }
    patch[urlField] = url;
    patch._dataSource = "official";
    patch._lastUpdated = new Date().toISOString().split("T")[0];

    const oldValue = schemaDef.rateFields.map((f) => `${f}=${row[f]}`).join(", ");
    const newValue = schemaDef.rateFields.map((f) => `${f}=${patch[f]}`).join(", ");
    const changed = schemaDef.rateFields.some((f) => !rateNumericallyEqual(String(row[f] ?? ""), String(patch[f] ?? "")));
    log("update_row", { provider: providerName, url, oldValue, newValue, changed });

    const { updated: u } = await updateRecords([patch], dataset, schemaDef, db);
    updates += u;
    return true;
  }

  // Official rows: scrape stored URL directly
  for (const row of officialRows) {
    if (signal?.aborted) break;
    const url = String(row[urlField]);
    const providerName = schemaDef.dedupeKey.map((k) => row[k]).join(" / ");
    try {
      if (!await extractAndUpdate(row, url, providerName)) failed++;
    } catch (err) {
      log("error", { tool: "update", message: `${providerName}: ${err instanceof Error ? err.message : String(err)}` });
      failed++;
    }
  }

  // Comparison-only rows: search for official URL first
  if (comparisonRows.length > 0) {
    if (!serpApiKey) {
      log("log", { message: `Skipping ${comparisonRows.length} comparison-only rows (no SERPAPI_KEY configured)` });
    } else {
      for (const row of comparisonRows) {
        if (signal?.aborted) break;
        const providerName = schemaDef.dedupeKey.map((k) => row[k]).join(" / ");
        try {
          // Append rate field names to the search query to target the rates page directly
          const rateKeyword = schemaDef.rateFields.join(" ");
          const searchQuery = `${providerName} ${rateKeyword}`;
          log("log", { message: `Searching for official URL: ${searchQuery}` });
          const results = await searchGoogle(searchQuery, serpApiKey);
          const officialUrl = results.find((u) => !isComparisonUrl(u));
          if (!officialUrl) {
            log("log", { message: `${providerName}: no official URL found in search results` });
            failed++;
            continue;
          }
          log("log", { message: `${providerName}: found ${officialUrl}` });
          if (!await extractAndUpdate(row, officialUrl, providerName)) failed++;
        } catch (err) {
          log("error", { tool: "update", message: `${providerName}: ${err instanceof Error ? err.message : String(err)}` });
          failed++;
        }
      }
    }
  }

  log("log", { message: `Done. ${updates} rows updated, ${failed} failed.` });
}
