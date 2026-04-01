import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { initRecordsSchema } from "../tools/records.js";

const DB_PATH = "data/scrappy.db";

mkdirSync("data", { recursive: true });
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

initRecordsSchema(db);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL,
    params      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    result      TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id  TEXT NOT NULL,
    type    TEXT NOT NULL,
    payload TEXT NOT NULL,
    ts      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_job_id ON events(job_id);

  CREATE TABLE IF NOT EXISTS schemas (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    fields       TEXT NOT NULL,
    dedupe_key   TEXT NOT NULL,
    url_field    TEXT NOT NULL,
    tracked_fields TEXT NOT NULL,
    naming_rules TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_name TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    description     TEXT,
    logo_url        TEXT,
    external_url    TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );
`);

// Add entity_field column to schemas if not present (idempotent migration)
try { db.exec(`ALTER TABLE schemas ADD COLUMN entity_field TEXT`); } catch { /* already exists */ }
// Rename rate_fields → tracked_fields (idempotent migration)
try { db.exec(`ALTER TABLE schemas RENAME COLUMN rate_fields TO tracked_fields`); } catch { /* already renamed */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS qa_issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset     TEXT NOT NULL,
    ran_at      TEXT NOT NULL,
    type        TEXT NOT NULL,
    record_ids  TEXT NOT NULL,
    field       TEXT,
    payload     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open'
  );
  CREATE INDEX IF NOT EXISTS idx_qa_issues_dataset ON qa_issues(dataset);
`);

// Mark any jobs that were running when the server last stopped as cancelled
db.prepare(
  `UPDATE jobs SET status='cancelled', finished_at=?, result='Server restarted' WHERE status='running'`
).run(new Date().toISOString());

// --- Jobs ---

export interface DbJob {
  id: string;
  type: string;
  status: string;
  params: Record<string, string>;
  started_at: string;
  finished_at?: string;
  result?: string;
}

const stmtInsertJob = db.prepare(
  `INSERT INTO jobs (id, type, status, params, started_at) VALUES (?, ?, ?, ?, ?)`
);
export function dbInsertJob(job: DbJob): void {
  stmtInsertJob.run(job.id, job.type, job.status, JSON.stringify(job.params), job.started_at);
}

const stmtUpdateJob = db.prepare(
  `UPDATE jobs SET status=?, finished_at=?, result=? WHERE id=?`
);
export function dbFinishJob(id: string, status: string, finishedAt: string, result?: string): void {
  stmtUpdateJob.run(status, finishedAt, result ?? null, id);
}

const stmtGetJob = db.prepare(`SELECT * FROM jobs WHERE id=?`);
export function dbGetJob(id: string): DbJob | undefined {
  const row = stmtGetJob.get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return { ...row, params: JSON.parse(row.params as string) } as DbJob;
}

export function dbClearJobs(): void {
  db.prepare(`DELETE FROM events WHERE job_id IN (SELECT id FROM jobs WHERE status != 'running')`).run();
  db.prepare(`DELETE FROM jobs WHERE status != 'running'`).run();
}

const stmtListJobs = db.prepare(`SELECT * FROM jobs ORDER BY started_at DESC`);
export function dbListJobs(): DbJob[] {
  return (stmtListJobs.all() as Record<string, unknown>[]).map((r) => ({
    ...r,
    params: JSON.parse(r.params as string),
  })) as DbJob[];
}

// --- Events ---

export interface DbEvent {
  id?: number;
  job_id: string;
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

const stmtInsertEvent = db.prepare(
  `INSERT INTO events (job_id, type, payload, ts) VALUES (?, ?, ?, ?)`
);
export function dbInsertEvent(jobId: string, type: string, payload: Record<string, unknown>): void {
  stmtInsertEvent.run(jobId, type, JSON.stringify(payload), new Date().toISOString());
}

const stmtGetEvents = db.prepare(`SELECT * FROM events WHERE job_id=? ORDER BY id`);
export function dbGetEvents(jobId: string): DbEvent[] {
  return (stmtGetEvents.all(jobId) as Record<string, unknown>[]).map((r) => ({
    ...r,
    payload: JSON.parse(r.payload as string),
  })) as DbEvent[];
}
