import type { SchemaDefinition, PageLink } from "../types.js";

export type { PageLink };

// Split camelCase/snake_case into individual words
export function splitIdentifier(s: string): string[] {
  return s.replace(/([A-Z])/g, " $1").toLowerCase().split(/[\s_-]+/).filter(Boolean);
}

// Normalize a path or anchor text for keyword matching.
// German URLs expand umlauts (ä→ae, ö→oe, ü→ue) so "zinssaetze" in a URL won't
// match the schema keyword "zinssatz" without this step. We also collapse the
// digraphs so both the URL form and the plain-text form reduce to the same string.
export function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
}

// Build a keyword regex from the schema: trackedFields, field names, dedupeKey, field descriptions
export function buildSchemaKeywordRe(schemaDef: SchemaDefinition): RegExp | null {
  const STOP = new Set(["name", "value", "field", "data", "info", "page", "item", "list",
    "type", "date", "time", "text", "link", "from", "with", "that", "this", "have",
    "will", "been", "they", "their", "url", "the", "and", "for", "per"]);
  const words = new Set<string>();

  // trackedFields are the strongest hint — they're literally what we're looking for
  for (const f of schemaDef.trackedFields) {
    splitIdentifier(f).forEach(w => { if (w.length >= 3 && !STOP.has(w)) words.add(normalizeForMatch(w)); });
  }
  // field names and dedupe keys
  for (const f of [...Object.keys(schemaDef.fieldDescriptions), ...schemaDef.dedupeKey]) {
    splitIdentifier(f).forEach(w => { if (w.length >= 4 && !STOP.has(w)) words.add(normalizeForMatch(w)); });
  }
  // meaningful words from field descriptions
  for (const desc of Object.values(schemaDef.fieldDescriptions)) {
    desc.split(/\W+/).forEach(w => { if (w.length >= 5 && !STOP.has(w.toLowerCase())) words.add(normalizeForMatch(w)); });
  }

  return words.size > 0 ? new RegExp([...words].join("|"), "i") : null;
}

// Build a regex from trackedFields only — the strongest path signal because
// they name the exact data we're looking for (e.g. "zinssatz" → zinssaetze.html).
export function buildFieldValueRe(schemaDef: SchemaDefinition): RegExp | null {
  const words = new Set<string>();
  for (const f of schemaDef.trackedFields) {
    splitIdentifier(f).forEach(w => { if (w.length >= 3) words.add(normalizeForMatch(w)); });
  }
  return words.size > 0 ? new RegExp([...words].join("|"), "i") : null;
}

// Generic detail/pricing/specs page URL patterns — covers product detail pages across
// all domains and languages (e.g. "konditionen", "tarife", "specs", "pricing").
// Scored between fieldValueRe (+4) and schemaKeywordRe (+2).
export const detailPageRe = /detail|spec|pricing|price|feature|kondition|tarif|preise?|taux|prix|prezzi|rates?|fees?|kosten|gebuhr|offert|produkt|product|plan/i;

// Score a link by how likely it leads to relevant data.
// URL path keywords are a strong signal; anchor text alone is weak (navigation menus
// often contain field-relevant terms but link to generic landing pages).
export function linkScore(
  link: PageLink,
  fieldValueRe: RegExp | null,
  schemaKeywordRe: RegExp | null
): number {
  let score = 0;
  let hasPathSignal = false;
  try {
    const path = normalizeForMatch(new URL(link.url).pathname);
    if (path.endsWith(".pdf")) { score += 3; hasPathSignal = true; }
    // fieldValue keywords in the path are the strongest signal (+4)
    if (fieldValueRe?.test(path)) { score += 4; hasPathSignal = true; }
    // generic detail/pricing page patterns are next (+3)
    else if (detailPageRe.test(path)) { score += 3; hasPathSignal = true; }
    // general schema keywords are weakest (+2)
    else if (schemaKeywordRe?.test(path)) { score += 2; hasPathSignal = true; }
  } catch { /* skip */ }
  const text = normalizeForMatch(link.text);
  if (fieldValueRe?.test(text)) score += 3;
  else if (schemaKeywordRe?.test(text)) score += 2;
  if (/pdf|document|download|dokument/i.test(text)) score += 1;
  // Anchor-text-only links are weaker (nav menus often have relevant terms
  // but link to generic landing pages). Still allow them at a lower effective score.
  return hasPathSignal ? score : Math.floor(score / 2);
}
