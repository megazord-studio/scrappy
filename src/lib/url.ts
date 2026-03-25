/**
 * Normalize a URL for deduplication: strip protocol, www, trailing slash.
 * Used by the agent loop when tracking visited URLs.
 */
export function normalizeUrl(url: string): string {
  return url.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/**
 * Normalize a URL more aggressively for record deduplication:
 * also strips common language-path prefixes (/de/, /fr/, /en/, /it/, /rm/).
 * Used by records deduplication.
 */
export function normalizeUrlForDedup(url: string): string {
  return normalizeUrl(url).replace(/\/(de|fr|en|it|rm)\//, "/");
}
