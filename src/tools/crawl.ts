import type { ScrapeResult, PageLink } from "../types.js";

const LINK_REGEX = /\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
// matches an HTML tag containing href, capturing href value and all remaining attributes
// so we can also extract data-tracking-topic / title / aria-label as link text
const TAG_REGEX = /<[^>]+href=["']([^"']+)["']([^>]*)>/gi;
const TEXT_ATTR_REGEX = /(?:data-tracking-topic|title|aria-label)=["']([^"']+)["']/i;

export async function scrapeUrl(
  url: string,
  crawl4aiBase: string
): Promise<ScrapeResult> {
  const res = await fetch(`${crawl4aiBase}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [url],
      crawler_config: {
        type: "CrawlerRunConfig",
        delay_before_return_html: 8,
        page_timeout: 60000,
        js_code: "window.scrollTo(0, document.body.scrollHeight);",
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Crawl4AI error for ${url}: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as {
    results?: Array<{
      markdown?: { raw_markdown?: string; fit_markdown?: string } | string;
      html?: string;
      cleaned_html?: string;
      success?: boolean;
      error_message?: string;
    }>;
  };

  const result = data.results?.[0];
  if (!result?.success) {
    throw new Error(`Crawl failed for ${url}: ${result?.error_message ?? "unknown error"}`);
  }

  const md = result.markdown;
  let markdown: string;
  if (typeof md === "string") {
    markdown = md;
  } else {
    const fit = md?.fit_markdown ?? "";
    const raw = md?.raw_markdown ?? "";
    console.error(`[crawl debug] fit=${fit.length} raw=${raw.length} keys=${Object.keys(md ?? {}).join(",")}`);
    // prefer fit_markdown, fall back to raw_markdown when fit is too short
    markdown = fit.length >= 200 ? fit : raw;
  }

  // extract markdown-formatted links
  const linkMap = new Map<string, string>(); // url → text (assembled into PageLink[] at return)
  let match: RegExpExecArray | null;
  LINK_REGEX.lastIndex = 0;
  while ((match = LINK_REGEX.exec(markdown)) !== null) {
    const mdText = /\[([^\]]*)\]/.exec(match[0])?.[1] ?? "";
    if (!linkMap.has(match[1])) linkMap.set(match[1], mdText);
  }

  // also scan raw HTML for href attributes (catches web components like <bal-list-item href>)
  // extract text from data-tracking-topic / title / aria-label for better link scoring
  const rawHtml = result.cleaned_html ?? result.html ?? "";
  const base = (() => { try { return new URL(url); } catch { return null; } })();
  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(rawHtml)) !== null) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const resolved = new URL(href, base ?? undefined).href;
      if (!linkMap.has(resolved)) {
        const textAttr = TEXT_ATTR_REGEX.exec(match[2] ?? "");
        linkMap.set(resolved, textAttr ? textAttr[1] : "");
      }
    } catch { /* ignore unparseable */ }
  }

  return { url, markdown, links: [...linkMap.entries()].map(([u, t]): PageLink => ({ url: u, text: t })) };
}
