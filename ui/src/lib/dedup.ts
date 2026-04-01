const BANK_STOPWORDS = new Set([
  'bank', 'kasse', 'und', 'der', 'die', 'von', 'fur', 'the', 'fuer',
  'kantonalbank', 'regionalbank', 'sparkasse', 'genossenschaft',
  'privatbank', 'handelsbank', 'hypothekarbank',
]);

export function normalizeDedupField(field: string, value: unknown): string {
  const v = String(value ?? '').toLowerCase().trim();
  if (field === 'bankName') {
    return v.replace(/\b(ag|sa|gmbh|ltd|inc|co\.?)\b/g, '').replace(/\s+/g, ' ').trim();
  }
  return v;
}

export function normalizeUrl(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/(de|fr|en|it|rm)\//, '/')
    .replace(/\/$/, '');
}

export function makeUrlFieldKey(row: Record<string, unknown>, trackedFields: string[]): string | null {
  const bank = normalizeDedupField('bankName', row['bankName'] ?? '');
  const url = normalizeUrl(row['url'] ?? '');
  if (!bank || !url) return null;
  const fieldValues = trackedFields.map(f => String(row[f] ?? '').trim().toLowerCase()).join('|');
  return `${bank}|${url}|${fieldValues}`;
}

export function extractNums(s: unknown): number[] {
  return [...String(s ?? '').matchAll(/(\d+[.,]\d+|\d+)/g)]
    .map(m => parseFloat(m[1].replace(',', '.')))
    .filter(n => !isNaN(n));
}

export function valuesOverlap(a: unknown, b: unknown): boolean {
  const na = extractNums(a), nb = extractNums(b);
  return na.length > 0 && nb.length > 0 && na.some(x => nb.some(y => Math.abs(x - y) < 0.01));
}

export function bankKeywords(name: unknown): string[] {
  return String(name ?? '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-zäöü\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !BANK_STOPWORDS.has(w));
}

export function bankKeywordsOverlap(a: unknown, b: unknown): boolean {
  const kwA = new Set(bankKeywords(a));
  return bankKeywords(b).some(k => kwA.has(k));
}

export function rowPairScore(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  keyFields: string[],
  trackedFields: string[]
): number {
  const keyA = keyFields.map(f => normalizeDedupField(f, a[f])).join('|');
  const keyB = keyFields.map(f => normalizeDedupField(f, b[f])).join('|');
  if (keyA === keyB) return 1.0;

  const urkA = makeUrlFieldKey(a, trackedFields);
  const urkB = makeUrlFieldKey(b, trackedFields);
  if (urkA && urkA === urkB) return 1.0;

  const bankA = normalizeDedupField('bankName', a['bankName'] ?? '');
  const bankB = normalizeDedupField('bankName', b['bankName'] ?? '');
  const rateMatch = trackedFields.some(f => valuesOverlap(a[f], b[f]));
  if (bankA === bankB && rateMatch) return 0.85;
  if (bankKeywordsOverlap(a['bankName'] ?? '', b['bankName'] ?? '') && rateMatch) return 0.65;

  const parts = keyA.split('|');
  const partsB = keyB.split('|');
  const matching = parts.filter((p, i) => p && p === partsB[i]).length;
  if (matching > 0) return (matching / parts.length) * 0.5;
  return 0;
}

function getNoDedupIds(row: Record<string, unknown>): Set<number> {
  return new Set(
    String(row._noDedup ?? '').split(',').filter(Boolean).map(Number)
  );
}

export function buildDupGroups(
  rows: Record<string, unknown>[],
  keyFields: string[],
  trackedFields: string[],
  threshold = 0.5
): Map<number, number[]> {
  const parent = rows.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const idI = Number(rows[i]._id);
      const idJ = Number(rows[j]._id);
      if (getNoDedupIds(rows[i]).has(idJ) || getNoDedupIds(rows[j]).has(idI)) continue;
      if (rowPairScore(rows[i], rows[j], keyFields, trackedFields) >= threshold) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  });
  return groups;
}

export function groupMaxScore(
  origIdx: number,
  groupIndices: number[],
  rows: Record<string, unknown>[],
  keyFields: string[],
  trackedFields: string[]
): number {
  return groupIndices
    .filter(j => j !== origIdx)
    .reduce((max, j) => Math.max(max, rowPairScore(rows[origIdx], rows[j], keyFields, trackedFields)), 0);
}

export function dupScaleHtml(score: number): string {
  const filled = Math.round(score * 5);
  const color = score >= 1 ? '#dc2626' : score >= 0.6 ? '#d97706' : score >= 0.2 ? '#6b7280' : '#d1d5db';
  const bars = Array.from({ length: 5 }, (_, i) =>
    `<span style="display:inline-block;width:5px;height:10px;border-radius:1px;background:${i < filled ? color : '#e5e7eb'};margin-right:1px"></span>`
  ).join('');
  const label = score >= 1 ? 'exact' : score >= 0.6 ? 'likely' : score >= 0.2 ? 'possible' : 'unique';
  return `<span title="${Math.round(score * 100)}% (${label})" style="display:inline-flex;align-items:center;gap:3px">${bars}</span>`;
}
