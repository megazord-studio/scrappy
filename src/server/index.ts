import "dotenv/config";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import staticPlugin from "@fastify/static";
import cookiePlugin from "@fastify/cookie";
import { timingSafeEqual, randomBytes } from "crypto";
import { resolve } from "path";
import { auth } from "./auth.js";
import { createJob, getJob, listJobs, getJobEvents, type Job } from "./jobs.js";
import { dbClearJobs } from "./db.js";
import { listSchemas, listOutputs, runIndexJob, runUpdateJob, getLLMClient } from "./runner.js";
import { readSettings, writeSettings } from "./settings.js";
import { db } from "./db.js";
import { readRecords, readRecordsPaginated, deduplicateDataset, mergeRecords, exportToCsv, deleteDataset, markNotDuplicate, deleteRecordsByIds } from "../tools/records.js";
import { runQaAgent, type QaIssue } from "../agent/qa.js";
import { dbGetSchemaRow, dbGetSchema, dbInsertSchema, dbUpdateSchema, dbDeleteSchema, type SchemaInput } from "./schema-store.js";
import { seedSchemasFromFiles } from "./seed-schemas.js";
import { normalizeEntityName } from "../lib/normalize.js";

const app = Fastify({ logger: false });

await app.register(cookiePlugin);

// Extend request with session user
declare module "fastify" {
  interface FastifyRequest {
    sessionUser?: { id: string; email: string; name: string; role: string };
  }
}

// Session preHandler — populates req.sessionUser for authenticated requests
const AUTH_PREFIX = "/api/auth";
const PUBLIC_PATHS = new Set(["/signin", "/signup", "/api/contact"]);

app.addHook("preHandler", async (req, reply) => {
  const path = req.url.split("?")[0];
  if (path.startsWith(AUTH_PREFIX)) return;
  if (PUBLIC_PATHS.has(path)) return;
  if (!path.startsWith("/api/")) return; // static files / SPA — let through

  const sessionData = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  });

  if (!sessionData) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  req.sessionUser = {
    id: sessionData.user.id,
    email: sessionData.user.email,
    name: sessionData.user.name,
    role: (sessionData.user as { role?: string }).role ?? "user",
  };
});

// Mount Better Auth at /api/auth/*
// Fastify consumes req.raw stream before we can pass it to Better Auth,
// so reconstruct a web-standard Request from the already-parsed body.
app.all("/api/auth/*", async (req, reply) => {
  const protocol = req.protocol ?? "http";
  const host = req.headers.host ?? "localhost";
  const url = `${protocol}://${host}${req.url}`;
  const headers = new Headers(req.headers as Record<string, string>);

  let bodyInit: string | undefined;
  if (req.body && !["GET", "HEAD"].includes(req.method)) {
    bodyInit = JSON.stringify(req.body);
    headers.set("content-type", "application/json");
  }

  const webRequest = new Request(url, {
    method: req.method,
    headers,
    body: bodyInit,
  });

  const response = await auth.handler(webRequest);

  reply.code(response.status);
  response.headers.forEach((value: string, key: string) => reply.header(key, value));
  reply.send(await response.text());
});

function requireApiKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const settings = readSettings();
  if (!settings.apiKey) {
    reply.code(401).send({ error: "no api key configured" });
    return false;
  }
  const header = String(req.headers["authorization"] ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const valid = timingSafeEqual(Buffer.from(token.padEnd(64)), Buffer.from(settings.apiKey.padEnd(64)));
    if (!valid || token !== settings.apiKey) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
  } catch {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

app.register(staticPlugin, {
  root: resolve("public"),
  prefix: "/",
});

// --- settings ---
app.get("/settings", async () => {
  let s = readSettings();
  if (!s.apiKey) s = writeSettings({ apiKey: randomBytes(32).toString("hex") });
  return s;
});
app.post("/settings", async (req) => {
  const body = req.body as Record<string, string>;
  const patch: Record<string, string> = {};
  const { llmProvider, anthropicAgentModel, anthropicExtractModel, openaiModel, openaiExtractModel,
          zordmindUrl, zordmindModel, crawl4aiBase, webhookUrl } = body;
  if (llmProvider === "anthropic" || llmProvider === "openai" || llmProvider === "zordmind") patch.llmProvider = llmProvider;
  if (anthropicAgentModel) patch.anthropicAgentModel = anthropicAgentModel;
  if (anthropicExtractModel) patch.anthropicExtractModel = anthropicExtractModel;
  if (openaiModel) patch.openaiModel = openaiModel;
  if (openaiExtractModel) patch.openaiExtractModel = openaiExtractModel;
  if (zordmindUrl) patch.zordmindUrl = zordmindUrl;
  if (zordmindModel) patch.zordmindModel = zordmindModel;
  if (crawl4aiBase) patch.crawl4aiBase = crawl4aiBase;
  if (webhookUrl !== undefined) patch.webhookUrl = webhookUrl;
  return writeSettings(patch);
});

// --- schemas & outputs ---
app.get("/schemas", async () => ({ schemas: listSchemas() }));
app.get("/outputs", async () => ({ outputs: listOutputs() }));
app.get("/outputs/:dataset/schema", async (req) => {
  const { dataset } = req.params as { dataset: string };
  const name = dataset.replace(/\.csv$/i, "");
  const row = db.prepare(
    `SELECT params FROM jobs
     WHERE json_extract(params, '$.schema') IS NOT NULL
       AND (json_extract(params, '$.output') = ? OR json_extract(params, '$.input') = ?)
     ORDER BY started_at DESC LIMIT 1`
  ).get(name, name) as { params: string } | undefined;
  const schemaId = row ? ((JSON.parse(row.params) as Record<string, string>).schema ?? null) : null;
  return { schemaId };
});

// --- schema CRUD ---
app.get("/schemas/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = dbGetSchemaRow(db, id);
  if (!row) return reply.code(404).send({ error: "not found" });
  return row;
});

app.post("/schemas", async (req, reply) => {
  const input = req.body as SchemaInput;
  if (!input.id || !input.display_name || !Array.isArray(input.fields) || !input.url_field) {
    return reply.code(400).send({ error: "id, display_name, fields, url_field required" });
  }
  try {
    dbInsertSchema(db, input);
    return { ok: true };
  } catch (err) {
    return reply.code(409).send({ error: err instanceof Error ? err.message : "conflict" });
  }
});

app.put("/schemas/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const input = req.body as Omit<SchemaInput, "id">;
  if (!input.display_name || !Array.isArray(input.fields) || !input.url_field) {
    return reply.code(400).send({ error: "display_name, fields, url_field required" });
  }
  if (!dbGetSchemaRow(db, id)) return reply.code(404).send({ error: "not found" });
  dbUpdateSchema(db, id, input);
  return { ok: true };
});

app.delete("/schemas/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = dbDeleteSchema(db, id);
  if (!result.deleted) return reply.code(409).send({ error: result.reason });
  return { ok: true };
});

// --- start index job ---
app.post("/jobs/index", async (req, reply) => {
  if (!requireApiKey(req, reply)) return;
  const { topic, schema, output, maxIterations, seedUrls } = req.body as Record<string, string>;
  if (!topic || !schema || !output) {
    return reply.code(400).send({ error: "topic, schema, output required" });
  }
  const params: Record<string, string> = { topic, schema, output };
  if (maxIterations) params.maxIterations = maxIterations;
  if (seedUrls) params.seedUrls = seedUrls;
  const job = createJob("index", params);
  runIndexJob(job); // fire and forget
  return { id: job.id };
});

// --- start update job ---
app.post("/jobs/update", async (req, reply) => {
  if (!requireApiKey(req, reply)) return;
  const body = req.body as { input: string; schema: string; filter?: string; recordId?: number; deepSearch?: boolean };
  const { input, schema, filter, recordId, deepSearch } = body;
  if (!input || !schema) {
    return reply.code(400).send({ error: "input, schema required" });
  }
  const params: Record<string, string> = { input, schema };
  if (filter) params.filter = filter;
  if (recordId != null) params.recordId = String(recordId);
  if (deepSearch) params.deepSearch = "true";
  const job = createJob("update", params);
  runUpdateJob(job); // fire and forget
  return { id: job.id };
});

// --- cancel job ---
app.post("/jobs/:id/cancel", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = getJob(id);
  if (!job) return reply.code(404).send({ error: "not found" });
  if (job.status !== "running") return reply.code(400).send({ error: "job not running" });
  job.abortController.abort();
  return { ok: true };
});

// --- clear completed/failed/cancelled jobs ---
app.post("/jobs/clear", async () => { dbClearJobs(); return { ok: true }; });

// --- list jobs ---
app.get("/jobs", async () => ({ jobs: listJobs() }));

// --- job detail ---
app.get("/jobs/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = getJob(id);
  if (!job) return reply.code(404).send({ error: "not found" });
  const { subscribers: _, abortController: __, ...rest } = job;
  return rest;
});

// --- structured events (for dashboard) ---
app.get("/jobs/:id/events", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = getJob(id);
  if (!job) return reply.code(404).send({ error: "not found" });
  return { events: getJobEvents(id) };
});

// --- SSE log stream ---
app.get("/jobs/:id/stream", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = getJob(id);
  if (!job) return reply.code(404).send({ error: "not found" });

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (type: string, payload: Record<string, unknown>, ts: string) => {
    reply.raw.write(`data: ${JSON.stringify({ type, payload, ts })}\n\n`);
  };

  // Replay existing events
  for (const e of getJobEvents(id)) {
    sendEvent(e.type, e.payload, e.ts);
  }

  if (job.status !== "running") {
    sendEvent("__done__", { status: job.status }, new Date().toISOString());
    reply.raw.end();
    return reply;
  }

  // Subscribe to future events
  const handler = (e: { type: string; payload: Record<string, unknown>; ts: string }) => {
    sendEvent(e.type, e.payload, e.ts);
    if (e.type === "__done__") reply.raw.end();
  };
  (job as Job).subscribers.add(handler);

  req.raw.on("close", () => {
    (job as Job).subscribers.delete(handler);
  });

  return reply;
});

function validDataset(dataset: string, reply: FastifyReply): string | null {
  if (dataset.includes("..")) { reply.code(400).send({ error: "invalid" }); return null; }
  return dataset.replace(/\.csv$/i, "");
}

// --- export dataset as CSV download ---
app.get("/outputs/:dataset", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  const jobRow = db.prepare(
    "SELECT params FROM jobs WHERE json_extract(params, '$.output') = ? OR json_extract(params, '$.input') = ? ORDER BY started_at DESC LIMIT 1"
  ).get(name, name) as { params: string } | undefined;
  if (!jobRow) return reply.code(404).send({ error: "dataset not found" });
  const params = JSON.parse(jobRow.params) as Record<string, string>;
  const schemaDef = dbGetSchema(db, params.schema);
  if (!schemaDef) return reply.code(404).send({ error: `schema "${params.schema}" not found` });
  const csv = exportToCsv(name, schemaDef, db);
  reply.header("Content-Type", "text/csv");
  reply.header("Content-Disposition", `attachment; filename="${name}.csv"`);
  return reply.send(csv);
});

// --- delete dataset ---
app.delete("/outputs/:dataset", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  deleteDataset(name, db);
  return { ok: true };
});

// --- dedupe dataset ---
app.post("/outputs/:dataset/dedupe", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  // Resolve dedupeKey from the schema associated with this dataset
  const jobRow = db.prepare(
    "SELECT params FROM jobs WHERE json_extract(params, '$.output') = ? OR json_extract(params, '$.input') = ? ORDER BY started_at DESC LIMIT 1"
  ).get(name, name) as { params: string } | undefined;
  let dedupeKey: string[] | undefined;
  if (jobRow) {
    const schemaId = (JSON.parse(jobRow.params) as Record<string, string>).schema ?? null;
    if (schemaId) {
      const schemaRow = db.prepare("SELECT dedupe_key FROM schemas WHERE id = ?").get(schemaId) as { dedupe_key: string } | undefined;
      if (schemaRow) dedupeKey = JSON.parse(schemaRow.dedupe_key) as string[];
    }
  }
  return deduplicateDataset(name, db, dedupeKey);
});

// --- mark rows as not duplicates ---
app.post("/outputs/:dataset/not-duplicate", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  if (!validDataset(dataset, reply)) return;
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length < 2) {
    return reply.code(400).send({ error: "ids array with at least 2 elements required" });
  }
  markNotDuplicate(ids, db);
  return { ok: true };
});

// --- merge rows by DB id ---
app.post("/outputs/:dataset/merge-rows", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  const { keepId, removeIds } = req.body as { keepId: number; removeIds: number[] };
  if (typeof keepId !== "number" || !Array.isArray(removeIds)) {
    return reply.code(400).send({ error: "keepId (number) and removeIds (array) required" });
  }
  const kept = mergeRecords(keepId, removeIds, db);
  if (!kept) return reply.code(404).send({ error: "record not found" });
  return { ok: true, kept };
});

// --- patch a single field on a record ---
app.patch("/outputs/:dataset/records/:id", async (req, reply) => {
  const { dataset, id } = req.params as { dataset: string; id: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  const { field, value } = req.body as { field?: string; value?: string };
  if (!field || value === undefined) return reply.code(400).send({ error: "field and value required" });
  const row = db.prepare("SELECT data FROM records WHERE id = ? AND dataset = ?").get(Number(id), name) as { data: string } | undefined;
  if (!row) return reply.code(404).send({ error: "record not found" });
  const data = JSON.parse(row.data) as Record<string, unknown>;
  data[field] = value;
  db.prepare("UPDATE records SET data = ? WHERE id = ?").run(JSON.stringify(data), Number(id));
  return { ok: true };
});

// --- delete individual records by id ---
app.delete("/outputs/:dataset/records", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  if (!validDataset(dataset, reply)) return;
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) return reply.code(400).send({ error: "ids required" });
  deleteRecordsByIds(ids, db);
  return { ok: true, deleted: ids.length };
});

// --- records as JSON (paginated, filterable) ---
app.get("/outputs/:dataset/records", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  const q = req.query as Record<string, string>;

  const filter: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const m = k.match(/^filter\[(.+)\]$/);
    if (m) filter[m[1]] = v;
  }

  const limit = q.limit ? parseInt(q.limit, 10) : 200;
  const offset = q.offset ? parseInt(q.offset, 10) : 0;

  const { rows, total } = readRecordsPaginated(name, db, {
    limit,
    offset,
    sort: q.sort,
    order: q.order === "desc" ? "desc" : "asc",
    filter,
  });

  if (total === 0) return { headers: [], rows: [], total: 0, limit, offset };
  const headers = Object.keys(rows[0]).filter((k) => k !== "_id");
  return { headers, rows, total, limit, offset };
});

// --- QA ---

interface DbQaIssue {
  id: number;
  dataset: string;
  ran_at: string;
  type: string;
  record_ids: string;
  field: string | null;
  payload: string;
  status: string;
}

function dbQaIssueToJson(row: DbQaIssue) {
  return {
    id: row.id,
    dataset: row.dataset,
    ran_at: row.ran_at,
    type: row.type,
    record_ids: JSON.parse(row.record_ids) as number[],
    field: row.field,
    payload: JSON.parse(row.payload) as QaIssue,
    status: row.status,
  };
}

// Run QA agent on a dataset — synchronous, returns issues immediately
app.post("/outputs/:dataset/qa", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;

  // Resolve schema from the most recent index job for this dataset
  const jobRow = db.prepare(
    "SELECT params FROM jobs WHERE type='index' AND json_extract(params, '$.output') = ? ORDER BY started_at DESC LIMIT 1"
  ).get(name) as { params: string } | undefined;
  if (!jobRow) return reply.code(404).send({ error: "No index job found for this dataset" });

  const params = JSON.parse(jobRow.params) as Record<string, string>;
  const schemaDef = dbGetSchema(db, params.schema);
  if (!schemaDef) return reply.code(404).send({ error: `Schema "${params.schema}" not found` });

  const records = readRecords(name, db);
  if (records.length === 0) return reply.code(400).send({ error: "Dataset is empty" });

  const llmClient = getLLMClient();
  const ranAt = new Date().toISOString();
  const issues = await runQaAgent(records, schemaDef, llmClient);

  // Clear previous open issues for this dataset and insert fresh ones
  db.prepare("DELETE FROM qa_issues WHERE dataset = ? AND status = 'open'").run(name);

  const insert = db.prepare(
    "INSERT INTO qa_issues (dataset, ran_at, type, record_ids, field, payload, status) VALUES (?, ?, ?, ?, ?, ?, 'open')"
  );
  db.transaction((rows: QaIssue[]) => {
    for (const issue of rows) {
      const recordIds = issue.type === "fuzzy_dupe" ? issue.ids : [issue.id];
      const field = issue.type !== "fuzzy_dupe" ? issue.field : null;
      insert.run(name, ranAt, issue.type, JSON.stringify(recordIds), field, JSON.stringify(issue));
    }
  })(issues);

  const stored = (db.prepare("SELECT * FROM qa_issues WHERE dataset = ? AND ran_at = ? ORDER BY id").all(name, ranAt) as DbQaIssue[])
    .map(dbQaIssueToJson);

  return { ran_at: ranAt, count: issues.length, issues: stored };
});

// Get stored QA issues for a dataset
app.get("/outputs/:dataset/qa", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = validDataset(dataset, reply);
  if (!name) return;
  const q = req.query as { status?: string };
  const status = q.status ?? "open";
  const rows = (db.prepare("SELECT * FROM qa_issues WHERE dataset = ? AND status = ? ORDER BY id").all(name, status) as DbQaIssue[])
    .map(dbQaIssueToJson);
  return { issues: rows };
});

// Update issue status (dismiss or mark applied)
app.patch("/outputs/:dataset/qa/:id", async (req, reply) => {
  const { id } = req.params as { dataset: string; id: string };
  const { status } = req.body as { status: string };
  if (!["open", "dismissed", "applied"].includes(status)) {
    return reply.code(400).send({ error: "status must be open, dismissed, or applied" });
  }
  const result = db.prepare("UPDATE qa_issues SET status = ? WHERE id = ?").run(status, Number(id));
  if (result.changes === 0) return reply.code(404).send({ error: "issue not found" });
  return { ok: true };
});

// --- entities ---

interface DbEntityRow {
  id: number;
  normalized_name: string;
  display_name: string;
  description: string | null;
  logo_url: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

app.get("/entities", async () => {
  const schemas = db.prepare("SELECT id, entity_field FROM schemas WHERE entity_field IS NOT NULL AND entity_field != ''")
    .all() as { id: string; entity_field: string }[];

  const entityFields = [...new Set(schemas.map(s => s.entity_field))];

  // normalized_name → { displayNames: Map<rawName, count>, datasets: Set<string>, count }
  const entityMap = new Map<string, { displayNames: Map<string, number>; datasets: Set<string>; count: number }>();

  for (const fieldName of entityFields) {
    const rows = db.prepare(
      `SELECT dataset, json_extract(data, '$.' || ?) as val FROM records WHERE json_extract(data, '$.' || ?) IS NOT NULL AND json_extract(data, '$.' || ?) != ''`
    ).all(fieldName, fieldName, fieldName) as { dataset: string; val: string }[];

    for (const row of rows) {
      const normalized = normalizeEntityName(row.val);
      if (!normalized) continue;
      if (!entityMap.has(normalized)) entityMap.set(normalized, { displayNames: new Map(), datasets: new Set(), count: 0 });
      const entry = entityMap.get(normalized)!;
      entry.datasets.add(row.dataset);
      entry.count++;
      entry.displayNames.set(row.val, (entry.displayNames.get(row.val) ?? 0) + 1);
    }
  }

  const enrichments = db.prepare("SELECT * FROM entities").all() as DbEntityRow[];
  const enrichMap = new Map(enrichments.map(e => [e.normalized_name, e]));

  const entities = Array.from(entityMap.entries()).map(([normalized_name, info]) => {
    const enrich = enrichMap.get(normalized_name);
    const display_name = enrich?.display_name
      ?? [...info.displayNames.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      ?? normalized_name;
    return {
      id: enrich?.id ?? null,
      normalized_name,
      display_name,
      description: enrich?.description ?? null,
      logo_url: enrich?.logo_url ?? null,
      external_url: enrich?.external_url ?? null,
      record_count: info.count,
      datasets: [...info.datasets],
    };
  }).sort((a, b) => a.display_name.localeCompare(b.display_name));

  return { entities };
});

app.get("/entities/:key/records", async (req, reply) => {
  const key = decodeURIComponent((req.params as { key: string }).key);
  const schemas = db.prepare("SELECT id, entity_field FROM schemas WHERE entity_field IS NOT NULL AND entity_field != ''")
    .all() as { id: string; entity_field: string }[];
  const entityFields = [...new Set(schemas.map(s => s.entity_field))];

  const datasetMap = new Map<string, { schema_id: string | null; records: Record<string, unknown>[] }>();

  for (const fieldName of entityFields) {
    const rows = db.prepare(
      `SELECT id, dataset, data FROM records WHERE json_extract(data, '$.' || ?) IS NOT NULL AND json_extract(data, '$.' || ?) != ''`
    ).all(fieldName, fieldName) as { id: number; dataset: string; data: string }[];

    for (const row of rows) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      if (normalizeEntityName(String(data[fieldName] ?? '')) !== key) continue;
      if (!datasetMap.has(row.dataset)) {
        const jobRow = db.prepare(
          "SELECT params FROM jobs WHERE type='index' AND json_extract(params, '$.output') = ? ORDER BY started_at DESC LIMIT 1"
        ).get(row.dataset) as { params: string } | undefined;
        let schema_id = jobRow ? ((JSON.parse(jobRow.params) as Record<string, string>).schema ?? null) : null;
        // Fallback: find a schema that has this entity_field set
        if (!schema_id) {
          const schemaRow = db.prepare("SELECT id FROM schemas WHERE entity_field = ? LIMIT 1").get(fieldName) as { id: string } | undefined;
          schema_id = schemaRow?.id ?? null;
        }
        datasetMap.set(row.dataset, { schema_id, records: [] });
      }
      datasetMap.get(row.dataset)!.records.push({ ...data, _id: String(row.id) });
    }
  }

  const enrich = db.prepare("SELECT display_name FROM entities WHERE normalized_name = ?").get(key) as { display_name: string } | undefined;
  const firstRecord = [...datasetMap.values()][0]?.records[0];
  const entityFieldName = entityFields[0];
  const display_name = enrich?.display_name
    ?? (firstRecord && entityFieldName ? String(firstRecord[entityFieldName] ?? key) : key);

  return {
    display_name,
    datasets: [...datasetMap.entries()].map(([dataset, info]) => ({
      dataset,
      schema_id: info.schema_id,
      records: info.records,
    })),
  };
});

app.put("/entities/:key", async (req) => {
  const key = decodeURIComponent((req.params as { key: string }).key);
  const body = req.body as { display_name: string; description?: string; logo_url?: string; external_url?: string };
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO entities (normalized_name, display_name, description, logo_url, external_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name=excluded.display_name,
      description=excluded.description,
      logo_url=excluded.logo_url,
      external_url=excluded.external_url,
      updated_at=excluded.updated_at
  `).run(key, body.display_name, body.description ?? null, body.logo_url ?? null, body.external_url ?? null, now, now);
  return db.prepare("SELECT * FROM entities WHERE normalized_name = ?").get(key) as DbEntityRow;
});

app.delete("/entities/:key", async (req) => {
  const key = decodeURIComponent((req.params as { key: string }).key);
  db.prepare("DELETE FROM entities WHERE normalized_name = ?").run(key);
  return { ok: true };
});

// --- chat ---
app.post("/chat", async (req, reply) => {
  try {
    const body = req.body as { message?: string; jobId?: string; history?: Array<{ role: "user" | "assistant"; content: string }> } | null;
    const message = body?.message ?? "";
    const jobId = body?.jobId;
    const history = body?.history ?? [];

    if (!message.trim()) return reply.code(400).send({ error: "message required" });

    const schemas = listSchemas();
    const datasets = listOutputs();

    let jobContext = "";
    if (jobId) {
      const events = getJobEvents(jobId).slice(-60);
      jobContext = "\n\nRecent job events:\n" + events
        .map(e => `[${e.ts}] ${e.type}: ${JSON.stringify(e.payload)}`)
        .join("\n");
    }

    const schemaDetails = schemas.map(s => {
      try {
        const row = db.prepare("SELECT fields, tracked_fields, dedupe_key FROM schemas WHERE id = ?").get(s.id) as { fields: string; tracked_fields: string; dedupe_key: string } | undefined;
        if (!row) return `- ${s.display_name} (id: ${s.id})`;
        const fields = (JSON.parse(row.fields) as { name: string; description: string }[]).map(f => f.name).join(", ");
        const trackedFields = JSON.parse(row.tracked_fields || "[]") as string[];
        const dedupeKey = JSON.parse(row.dedupe_key || "[]") as string[];
        return `- ${s.display_name} (id: ${s.id}, fields: ${fields}, tracked: ${trackedFields.join(", ") || "none"}, dedupe: ${dedupeKey.join(", ") || "none"})`;
      } catch { return `- ${s.display_name} (id: ${s.id})`; }
    }).join("\n");

    const system = `You are a focused assistant embedded in Scrappy, an AI-powered web scraping and data indexing tool. You help users with this specific tool only.

You ONLY answer questions about:
- Scrappy itself: schemas, datasets, index jobs, update jobs, deduplication, tracked fields
- Diagnosing why a job failed or found no results (use the job events)
- Suggesting schema improvements (fields, dedupe keys, tracked fields, naming rules)
- Understanding the data in a dataset

You MUST refuse any request outside this scope — including coding help, building other apps, general AI questions, or anything unrelated to Scrappy. For off-topic requests, respond with a single short sentence explaining you only assist with Scrappy.

Available schemas:\n${schemaDetails || "(none)"}

Available datasets: ${datasets.join(", ") || "(none)"}${jobContext}

Be concise and practical. If the user asks why something failed, look at the job events for clues.`;

    const llm = getLLMClient();
    const messages = [
      ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: message },
    ];
    const response = await llm.messages.create({
      model: llm.extractModel,
      max_tokens: 1024,
      system,
      messages,
    });
    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");
    return { reply: text };
  } catch (e) {
    return reply.code(500).send({ error: String(e) });
  }
});

// --- schema generation via LLM ---
app.post("/chat/schema", async (req, reply) => {
  try {
    const body = req.body as { description?: string } | null;
    const description = body?.description?.trim() ?? "";
    if (!description) return reply.code(400).send({ error: "description required" });

    const system = `You are a schema designer for Scrappy, an AI-powered web scraping tool.
Given a description of what the user wants to scrape, generate a schema definition.

Respond ONLY with valid JSON in this exact shape — no markdown, no explanation, just JSON:
{
  "reply": "A brief friendly sentence confirming what you created (1-2 sentences max)",
  "schema": {
    "id": "kebab-case-id",
    "display_name": "Human Readable Name",
    "fields": [
      { "name": "camelCaseFieldName", "optional": false, "description": "What to extract from the page" }
    ],
    "url_field": "url",
    "dedupe_key": ["primaryNameField"],
    "tracked_fields": ["changingField"],
    "naming_rules": ["fieldName: normalization instruction"]
  }
}

Rules:
- Always include a "url" field (url_field must point to it)
- Put the entity's primary name as the first field (e.g. bankName, schoolName, sellerName)
- dedupe_key: fields that uniquely identify a record (primary name + variant/product typically)
- tracked_fields: fields to actively refresh on updates (frequently-changing values) — omit if none
- naming_rules: short instructions like "bankName: use official brand name, not branch" — omit if not needed
- field names in camelCase, id in kebab-case, optional: true for fields that may not always exist`;

    const llm = getLLMClient();
    const response = await llm.messages.create({
      model: llm.extractModel,
      max_tokens: 1024,
      system,
      messages: [{ role: "user" as const, content: description }],
    });
    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("").trim();

    let parsed: unknown;
    try {
      // strip markdown code fences if present
      const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return reply.code(500).send({ error: "LLM returned invalid JSON", raw: text });
    }

    return reply.send(parsed);
  } catch (e) {
    return reply.code(500).send({ error: String(e) });
  }
});

// --- auth pages: serve SPA so client-side auth gate handles them ---
app.get("/signin", (_req, reply) => reply.sendFile("index.html"));
app.get("/signup", (_req, reply) => reply.sendFile("index.html"));

// --- contact / demo request (used by landing page) ---
app.options("/api/contact", async (_req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  return reply.code(204).send();
});

app.post("/api/contact", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  const { email } = req.body as { email?: string };
  if (!email || !email.includes("@")) {
    return reply.code(400).send({ error: "valid email required" });
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return reply.code(500).send({ error: "RESEND_API_KEY not configured" });

  const from = process.env.RESEND_FROM ?? "Scrappy <noreply@scrappy.studio>";
  const to = process.env.CONTACT_TO ?? "hello@scrappy.studio";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "New Demo Request — Scrappy",
      html: `<p>New early access request:</p><p><strong>${email}</strong></p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return reply.code(502).send({ error: "failed to send email", detail: body });
  }
  return { ok: true };
});

await seedSchemasFromFiles(db);

const port = parseInt(process.env.PORT ?? "3000", 10);
await app.listen({ port, host: "0.0.0.0" });
console.log(`scrappy server running on http://localhost:${port}`);
