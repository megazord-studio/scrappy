import { runAgent } from "../agent/loop.js";
import { runUpdate } from "../commands/update.js";
import { appendRecords, listDatasets } from "../tools/records.js";
import type { RunConfig, SchemaDefinition, ExtractedRecord, EmitFn } from "../types.js";
import { emitEvent, finishJob, type Job } from "./jobs.js";
import { db } from "./db.js";
import { readSettings } from "./settings.js";
import { createAnthropicClient, createOpenAIClient, createZordMindClient } from "../agent/llm-client.js";
import { dbListSchemas, dbGetSchema } from "./schema-store.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_KEY ?? "";
const SERPAPI_KEY = process.env.SERPAPI_KEY ?? "";

export function getLLMClient() {
  return makeLLMClient();
}

function makeLLMClient() {
  const settings = readSettings();
  if (settings.llmProvider === "openai") {
    return createOpenAIClient(OPENAI_API_KEY, settings.openaiModel, settings.openaiExtractModel);
  }
  if (settings.llmProvider === "zordmind") {
    return createZordMindClient(settings.zordmindUrl, settings.zordmindModel);
  }
  return createAnthropicClient(ANTHROPIC_API_KEY, settings.anthropicAgentModel, settings.anthropicExtractModel);
}

export function listSchemas(): { id: string; display_name: string }[] {
  return dbListSchemas(db);
}

export function listOutputs(): string[] {
  return listDatasets(db);
}

function loadSchema(name: string): SchemaDefinition {
  const def = dbGetSchema(db, name);
  if (!def) throw new Error(`Schema "${name}" not found in database`);
  return def;
}

function makeEmitter(job: Job): EmitFn {
  return (type, payload) => emitEvent(job, type, payload);
}

export async function runIndexJob(job: Job): Promise<void> {
  const { topic, schema, output } = job.params;
  const emit = makeEmitter(job);

  try {
    const settings = readSettings();
    const llmClient = makeLLMClient();
    const schemaDef = loadSchema(schema);
    const dataset = output.replace(/\.csv$/i, "");

    const config: RunConfig = {
      topic,
      schemaDef,
      maxDepth: 3,
      maxIterations: job.params.maxIterations ? Number(job.params.maxIterations) : 40,
      seedUrls: job.params.seedUrls ? job.params.seedUrls.split(",").map((u) => u.trim()).filter(Boolean) : undefined,
    };

    let totalWritten = 0;
    let totalPromoted = 0;
    let totalSkipped = 0;
    const onRecords = async (records: ExtractedRecord[]) => {
      const { written, promoted, skipped } = await appendRecords(records, dataset, schemaDef, db);
      totalWritten += written;
      totalPromoted += promoted;
      totalSkipped += skipped;
    };

    await runAgent(config, llmClient, SERPAPI_KEY, settings.crawl4aiBase, onRecords, emit, job.abortController.signal);
    if (job.abortController.signal.aborted) {
      finishJob(job, "cancelled", "Cancelled by user");
    } else {
      finishJob(job, "done", `${totalWritten} records written, ${totalPromoted} promoted, ${totalSkipped} duplicates skipped → ${dataset}`);
    }
  } catch (err) {
    finishJob(job, "failed", err instanceof Error ? err.message : String(err));
  }
}

export async function runUpdateJob(job: Job): Promise<void> {
  const { input, schema } = job.params;
  const emit = makeEmitter(job);

  try {
    const settings = readSettings();
    const llmClient = makeLLMClient();
    const schemaDef = loadSchema(schema);
    const dataset = input.replace(/\.csv$/i, "");

    const recordIds = job.params.recordId ? [Number(job.params.recordId)] : undefined;
    await runUpdate(dataset, schemaDef, llmClient, settings.crawl4aiBase, {
      signal: job.abortController.signal,
      filter: job.params.filter,
      recordIds,
      serpApiKey: SERPAPI_KEY,
      deepSearch: job.params.deepSearch === "true",
      emit,
    });

    if (job.abortController.signal.aborted) {
      finishJob(job, "cancelled", "Cancelled by user");
    } else {
      finishJob(job, "done", `Update complete for ${dataset}`);
    }
  } catch (err) {
    finishJob(job, "failed", err instanceof Error ? err.message : String(err));
  }
}
