/**
 * Normalizes an entity name for cross-dataset matching.
 * Strips legal suffixes, punctuation, and whitespace so that
 * "UBS AG", "UBS Bank AG", and "UBS" all normalize to "ubs".
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(ag|sa|gmbh|ltd|inc|co\.?|llc|corp|plc|sas|nv|bv|ug|kg|oy|ab|as|aps|spa|srl)\b\.?/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
