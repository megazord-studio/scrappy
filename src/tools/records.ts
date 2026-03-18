import Database from "better-sqlite3";
import type { CsvRow, SchemaDefinition } from "../types.js";

// ─── Schema init ────────────────────────────────────────────────────────────

export function initRecordsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset     TEXT NOT NULL,
      data        TEXT NOT NULL,
      _data_source TEXT NOT NULL DEFAULT 'comparison',
      _last_updated TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_dataset ON records(dataset);
  `);
}

/** Create an isolated in-memory DB for tests */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  initRecordsSchema(db);
  return db;
}

// ─── Normalization (shared with dedup) ──────────────────────────────────────

function normalizeField(field: string, value: string): string {
  const v = value.toLowerCase().trim();
  if (field === "bankName") {
    return v.replace(/\b(ag|sa|gmbh|ltd|inc|co\.?)\b/g, "").replace(/\s+/g, " ").trim();
  }
  return v;
}

function makeKey(record: CsvRow, dedupeKey: string[]): string {
  return dedupeKey.map((k) => normalizeField(k, String(record[k] ?? ""))).join("|");
}

function normalizeUrl(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/(de|fr|en|it|rm)\//, "/")
    .replace(/\/$/, "");
}

function makeUrlRateKey(record: CsvRow, schemaDef: SchemaDefinition): string | null {
  const bank = normalizeField("bankName", String(record["bankName"] ?? ""));
  const url = normalizeUrl(String(record[schemaDef.urlField] ?? ""));
  if (!bank || !url) return null;
  const rates = schemaDef.rateFields.map((f) => String(record[f] ?? "").trim().toLowerCase()).join("|");
  return `${bank}|${url}|${rates}`;
}

// ─── Row serialization ───────────────────────────────────────────────────────

interface DbRow {
  id: number;
  dataset: string;
  data: string;
  _data_source: string;
  _last_updated: string;
}

function rowToCsvRow(r: DbRow): CsvRow {
  return {
    ...JSON.parse(r.data),
    _id: r.id,
    _dataSource: r._data_source,
    _lastUpdated: r._last_updated,
  };
}

function csvRowToDb(r: CsvRow): { data: string; dataSource: string; lastUpdated: string } {
  const { _dataSource, _lastUpdated, _id, ...rest } = r as CsvRow & {
    _dataSource?: string;
    _lastUpdated?: string;
    _id?: number;
  };
  return {
    data: JSON.stringify(rest),
    dataSource: _dataSource ?? "comparison",
    lastUpdated: _lastUpdated ?? new Date().toISOString().split("T")[0],
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function readRecords(dataset: string, db: Database.Database): CsvRow[] {
  return (db.prepare("SELECT * FROM records WHERE dataset = ? ORDER BY id").all(dataset) as DbRow[])
    .map(rowToCsvRow);
}

export interface PaginatedOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: "asc" | "desc";
  filter?: Record<string, string>;
}

export function readRecordsPaginated(
  dataset: string,
  db: Database.Database,
  opts: PaginatedOptions = {}
): { rows: CsvRow[]; total: number } {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;
  const order = opts.order === "desc" ? "DESC" : "ASC";

  const filterEntries = Object.entries(opts.filter ?? {});
  const filterSql = filterEntries
    .map(([k]) => `json_extract(data, '$.${k}') = ?`)
    .join(" AND ");
  const where = filterSql ? `dataset = ? AND ${filterSql}` : `dataset = ?`;
  const filterValues = filterEntries.map(([, v]) => v);

  const orderSql = opts.sort
    ? `json_extract(data, '$.${opts.sort}') ${order}`
    : `id ${order}`;

  const rows = (db
    .prepare(`SELECT * FROM records WHERE ${where} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(dataset, ...filterValues, limit, offset) as DbRow[])
    .map(rowToCsvRow);

  const { count } = db
    .prepare(`SELECT COUNT(*) as count FROM records WHERE ${where}`)
    .get(dataset, ...filterValues) as { count: number };

  return { rows, total: count };
}

export async function appendRecords(
  records: CsvRow[],
  dataset: string,
  schemaDef: SchemaDefinition,
  db: Database.Database
): Promise<{ written: number; promoted: number; skipped: number }> {
  const existing = readRecords(dataset, db);
  const existingByKey = new Map(existing.map((r) => [makeKey(r, schemaDef.dedupeKey), r]));
  const existingUrlRateKeys = new Set(
    existing.map((r) => makeUrlRateKey(r, schemaDef)).filter((k): k is string => k !== null)
  );

  const toInsert: CsvRow[] = [];
  const toPromote: CsvRow[] = [];

  for (const r of records) {
    const key = makeKey(r, schemaDef.dedupeKey);
    const existingRecord = existingByKey.get(key);
    if (existingRecord) {
      if (r._dataSource === "official" && existingRecord._dataSource === "comparison") {
        toPromote.push(r);
      }
      continue;
    }
    const urk = makeUrlRateKey(r, schemaDef);
    if (urk && existingUrlRateKeys.has(urk)) continue;
    toInsert.push(r);
  }

  if (toInsert.length > 0) {
    const insert = db.prepare(
      "INSERT INTO records (dataset, data, _data_source, _last_updated) VALUES (?, ?, ?, ?)"
    );
    db.transaction((rows: CsvRow[]) => {
      for (const r of rows) {
        const { data, dataSource, lastUpdated } = csvRowToDb(r);
        insert.run(dataset, data, dataSource, lastUpdated);
      }
    })(toInsert);
  }

  if (toPromote.length > 0) {
    const dbRows = db
      .prepare("SELECT * FROM records WHERE dataset = ?")
      .all(dataset) as DbRow[];
    const updateStmt = db.prepare(
      "UPDATE records SET data = ?, _data_source = ?, _last_updated = ? WHERE id = ?"
    );
    db.transaction(() => {
      for (const dbRow of dbRows) {
        const row = rowToCsvRow(dbRow);
        const incoming = toPromote.find(
          (r) => makeKey(r, schemaDef.dedupeKey) === makeKey(row, schemaDef.dedupeKey)
        );
        if (!incoming) continue;
        const merged = { ...row, ...incoming };
        const { data, lastUpdated } = csvRowToDb(merged);
        updateStmt.run(data, "official", lastUpdated, dbRow.id);
      }
    })();
  }

  const skipped = records.length - toInsert.length - toPromote.length;
  return { written: toInsert.length, promoted: toPromote.length, skipped };
}

export async function updateRecords(
  updates: CsvRow[],
  dataset: string,
  schemaDef: SchemaDefinition,
  db: Database.Database
): Promise<{ updated: number }> {
  const dbRows = db
    .prepare("SELECT * FROM records WHERE dataset = ?")
    .all(dataset) as DbRow[];

  const updateByKey = new Map(updates.map((r) => [makeKey(r, schemaDef.dedupeKey), r]));
  let updated = 0;

  const updateStmt = db.prepare(
    "UPDATE records SET data = ?, _data_source = ?, _last_updated = ? WHERE id = ?"
  );

  const doUpdates = db.transaction(() => {
    for (const dbRow of dbRows) {
      const row = rowToCsvRow(dbRow);
      const patch = updateByKey.get(makeKey(row, schemaDef.dedupeKey));
      if (!patch) continue;
      const merged = { ...row, ...patch };
      const { data, dataSource, lastUpdated } = csvRowToDb(merged);
      updateStmt.run(data, dataSource, lastUpdated, dbRow.id);
      updated++;
    }
  });
  doUpdates();

  return { updated };
}

export function listDatasets(db: Database.Database): string[] {
  return (
    db.prepare("SELECT DISTINCT dataset FROM records ORDER BY dataset").all() as Array<{
      dataset: string;
    }>
  ).map((r) => r.dataset);
}

export function deleteDataset(name: string, db: Database.Database): void {
  db.prepare("DELETE FROM records WHERE dataset = ?").run(name);
}

export function markNotDuplicate(ids: number[], db: Database.Database): void {
  const rows = ids
    .map(id => db.prepare("SELECT id, data FROM records WHERE id = ?").get(id) as { id: number; data: string } | undefined)
    .filter((r): r is { id: number; data: string } => r !== null && r !== undefined);

  const update = db.prepare("UPDATE records SET data = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      const otherIds = ids.filter(id => id !== row.id);
      const existing = String(data._noDedup ?? "").split(",").filter(Boolean).map(Number);
      const merged = [...new Set([...existing, ...otherIds])].join(",");
      data._noDedup = merged;
      update.run(JSON.stringify(data), row.id);
    }
  })();
}

export function deleteRecordsByIds(ids: number[], db: Database.Database): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...ids);
}

export function mergeRecords(
  keepId: number,
  removeIds: number[],
  db: Database.Database
): CsvRow | null {
  const keepRow = db.prepare("SELECT * FROM records WHERE id = ?").get(keepId) as DbRow | undefined;
  if (!keepRow) return null;

  const winner = { ...JSON.parse(keepRow.data) } as Record<string, unknown>;

  for (const rid of removeIds) {
    const other = db.prepare("SELECT data FROM records WHERE id = ?").get(rid) as { data: string } | undefined;
    if (!other) continue;
    const otherData = JSON.parse(other.data) as Record<string, unknown>;
    for (const [k, v] of Object.entries(otherData)) {
      if (!winner[k] && v) winner[k] = v;
    }
  }

  db.prepare("UPDATE records SET data = ? WHERE id = ?").run(JSON.stringify(winner), keepId);
  deleteRecordsByIds(removeIds, db);
  return winner as CsvRow;
}

// ─── Dedup ───────────────────────────────────────────────────────────────────

export function deduplicateDataset(
  dataset: string,
  db: Database.Database
): { before: number; after: number; removed: number } {
  const dbRows = db
    .prepare("SELECT * FROM records WHERE dataset = ? ORDER BY id")
    .all(dataset) as DbRow[];

  const normName = (s: string) =>
    s.toLowerCase().replace(/\b(ag|sa|gmbh|ltd|inc|co\.?)\b/g, "").replace(/\s+/g, " ").trim();

  const seen = new Map<string, number>(); // key → id (keep official over comparison)
  const toDelete: number[] = [];

  // Sort: official first so official rows "win"
  const sorted = [...dbRows].sort((a, b) => {
    return a._data_source === "official" && b._data_source !== "official" ? -1
      : a._data_source !== "official" && b._data_source === "official" ? 1
      : 0;
  });

  for (const row of sorted) {
    const parsed = JSON.parse(row.data) as Record<string, string>;
    const key = Object.entries(parsed)
      .filter(([k]) => k !== "url")
      .map(([, v]) => (v ?? "").toLowerCase())
      .join("|");
    const urlKey = parsed["url"] && parsed["bankName"]
      ? `${normName(parsed["bankName"])}|${normalizeUrl(parsed["url"])}`
      : null;

    const dupKey = urlKey ?? key;
    if (seen.has(key) || (urlKey && seen.has(urlKey))) {
      toDelete.push(row.id);
    } else {
      seen.set(key, row.id);
      if (urlKey) seen.set(urlKey, row.id);
    }
  }

  deleteRecordsByIds(toDelete, db);
  const after = dbRows.length - toDelete.length;
  return { before: dbRows.length, after, removed: toDelete.length };
}

// ─── CSV export ──────────────────────────────────────────────────────────────

export function exportToCsv(dataset: string, schemaDef: SchemaDefinition, db: Database.Database): string {
  const rows = readRecords(dataset, db);
  if (rows.length === 0) return "";
  const fields = [...Object.keys(schemaDef.schema.shape), "_dataSource", "_lastUpdated"];
  const escape = (v: string) => (v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    fields.join(","),
    ...rows.map((r) => fields.map((f) => escape(String(r[f] ?? ""))).join(",")),
  ];
  return lines.join("\n") + "\n";
}
