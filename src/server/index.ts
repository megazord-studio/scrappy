import "dotenv/config";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import staticPlugin from "@fastify/static";
import { timingSafeEqual, randomBytes } from "crypto";
import { resolve } from "path";
import { createJob, getJob, listJobs, getJobEvents, type Job } from "./jobs.js";
import { dbClearJobs } from "./db.js";
import { listSchemas, listOutputs, runIndexJob, runUpdateJob, getLLMClient } from "./runner.js";
import { readSettings, writeSettings } from "./settings.js";
import { db } from "./db.js";
import { readRecords, readRecordsPaginated, deduplicateDataset, mergeRecords, exportToCsv, deleteDataset, markNotDuplicate, deleteRecordsByIds } from "../tools/records.js";
import { dbGetSchemaRow, dbGetSchema, dbInsertSchema, dbUpdateSchema, dbDeleteSchema, type SchemaInput } from "./schema-store.js";
import { seedSchemasFromFiles } from "./seed-schemas.js";
import { normalizeEntityName } from "../lib/normalize.js";

const app = Fastify({ logger: false });


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
app.get("/outputs/:dataset/schema", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  const name = dataset.replace(/\.csv$/i, "");
  const row = db.prepare(
    "SELECT params FROM jobs WHERE type='index' AND json_extract(params, '$.output') = ? ORDER BY started_at DESC LIMIT 1"
  ).get(name) as { params: string } | undefined;
  if (!row) return reply.code(404).send({ schemaId: null });
  const schemaId = (JSON.parse(row.params) as Record<string, string>).schema ?? null;
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
  return deduplicateDataset(name, db);
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
        const schema_id = jobRow ? ((JSON.parse(jobRow.params) as Record<string, string>).schema ?? null) : null;
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
        const row = db.prepare("SELECT fields, rate_fields, dedupe_key FROM schemas WHERE id = ?").get(s.id) as { fields: string; rate_fields: string; dedupe_key: string } | undefined;
        if (!row) return `- ${s.display_name} (id: ${s.id})`;
        const fields = (JSON.parse(row.fields) as { name: string; description: string }[]).map(f => f.name).join(", ");
        const rateFields = JSON.parse(row.rate_fields || "[]") as string[];
        const dedupeKey = JSON.parse(row.dedupe_key || "[]") as string[];
        return `- ${s.display_name} (id: ${s.id}, fields: ${fields}, tracked: ${rateFields.join(", ") || "none"}, dedupe: ${dedupeKey.join(", ") || "none"})`;
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

await seedSchemasFromFiles(db);

const port = parseInt(process.env.PORT ?? "3000", 10);
await app.listen({ port, host: "0.0.0.0" });
console.log(`scrappy server running on http://localhost:${port}`);
