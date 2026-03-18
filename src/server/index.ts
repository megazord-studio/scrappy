import "dotenv/config";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import staticPlugin from "@fastify/static";
import cors from "@fastify/cors";
import { timingSafeEqual, randomBytes } from "crypto";
import { resolve } from "path";
import { createJob, getJob, listJobs, getJobEvents, type Job } from "./jobs.js";
import { dbClearJobs } from "./db.js";
import { listSchemas, listOutputs, runIndexJob, runUpdateJob } from "./runner.js";
import { readSettings, writeSettings } from "./settings.js";
import { db } from "./db.js";
import { readRecords, readRecordsPaginated, deduplicateDataset, mergeRecords, exportToCsv, deleteDataset, markNotDuplicate } from "../tools/records.js";
import { dbGetSchemaRow, dbGetSchema, dbInsertSchema, dbUpdateSchema, dbDeleteSchema, type SchemaInput } from "./schema-store.js";
import { seedSchemasFromFiles } from "./seed-schemas.js";

const app = Fastify({ logger: false });

app.register(cors, {
  origin: (origin, cb) => {
    const allowed = readSettings().allowedOrigins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!origin || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
      return cb(null, true);
    }
    cb(null, allowed.includes(origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
          zordmindUrl, zordmindModel, crawl4aiBase, allowedOrigins, webhookUrl } = body;
  if (llmProvider === "anthropic" || llmProvider === "openai" || llmProvider === "zordmind") patch.llmProvider = llmProvider;
  if (anthropicAgentModel) patch.anthropicAgentModel = anthropicAgentModel;
  if (anthropicExtractModel) patch.anthropicExtractModel = anthropicExtractModel;
  if (openaiModel) patch.openaiModel = openaiModel;
  if (openaiExtractModel) patch.openaiExtractModel = openaiExtractModel;
  if (zordmindUrl) patch.zordmindUrl = zordmindUrl;
  if (zordmindModel) patch.zordmindModel = zordmindModel;
  if (crawl4aiBase) patch.crawl4aiBase = crawl4aiBase;
  if (allowedOrigins !== undefined) patch.allowedOrigins = allowedOrigins;
  if (webhookUrl !== undefined) patch.webhookUrl = webhookUrl;
  return writeSettings(patch);
});

// --- schemas & outputs ---
app.get("/schemas", async () => ({ schemas: listSchemas() }));
app.get("/outputs", async () => ({ outputs: listOutputs() }));

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
  const { input, schema, filter } = req.body as Record<string, string>;
  if (!input || !schema) {
    return reply.code(400).send({ error: "input, schema required" });
  }
  const params: Record<string, string> = { input, schema };
  if (filter) params.filter = filter;
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

// --- export dataset as CSV download ---
app.get("/outputs/:dataset", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  if (dataset.includes("..")) return reply.code(400).send({ error: "invalid" });
  const name = dataset.replace(/\.csv$/i, "");
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
  if (dataset.includes("..")) return reply.code(400).send({ error: "invalid" });
  const name = dataset.replace(/\.csv$/i, "");
  deleteDataset(name, db);
  return { ok: true };
});

// --- dedupe dataset ---
app.post("/outputs/:dataset/dedupe", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  if (dataset.includes("..")) return reply.code(400).send({ error: "invalid" });
  const name = dataset.replace(/\.csv$/i, "");
  return deduplicateDataset(name, db);
});

// --- mark rows as not duplicates ---
app.post("/outputs/:dataset/not-duplicate", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  if (dataset.includes("..")) return reply.code(400).send({ error: "invalid" });
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
  if (dataset.includes("..")) return reply.code(400).send({ error: "invalid" });
  const name = dataset.replace(/\.csv$/i, "");
  const { keepId, removeIds } = req.body as { keepId: number; removeIds: number[] };
  if (typeof keepId !== "number" || !Array.isArray(removeIds)) {
    return reply.code(400).send({ error: "keepId (number) and removeIds (array) required" });
  }
  const kept = mergeRecords(keepId, removeIds, db);
  if (!kept) return reply.code(404).send({ error: "record not found" });
  return { ok: true, kept };
});

// --- records as JSON (paginated, filterable) ---
app.get("/outputs/:dataset/records", async (req, reply) => {
  const { dataset } = req.params as { dataset: string };
  if (dataset.includes("..")) return reply.code(400).send({ error: "invalid" });
  const name = dataset.replace(/\.csv$/i, "");
  const q = req.query as Record<string, string>;

  const filter: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const m = k.match(/^filter\[(.+)\]$/);
    if (m) filter[m[1]] = v;
  }

  const { rows, total } = readRecordsPaginated(name, db, {
    limit: q.limit ? parseInt(q.limit, 10) : undefined,
    offset: q.offset ? parseInt(q.offset, 10) : undefined,
    sort: q.sort,
    order: q.order === "desc" ? "desc" : "asc",
    filter,
  });

  if (total === 0) return { headers: [], rows: [], total: 0, limit: 200, offset: 0 };
  const headers = Object.keys(rows[0]).filter((k) => k !== "_id");
  return { headers, rows, total, limit: q.limit ? parseInt(q.limit, 10) : 200, offset: q.offset ? parseInt(q.offset, 10) : 0 };
});

await seedSchemasFromFiles(db);

const port = parseInt(process.env.PORT ?? "3000", 10);
await app.listen({ port, host: "0.0.0.0" });
console.log(`scrappy server running on http://localhost:${port}`);
