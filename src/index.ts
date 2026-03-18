import "dotenv/config";
import { program } from "commander";
import { pathToFileURL } from "url";
import { resolve } from "path";
import { runAgent } from "./agent/loop.js";
import { runUpdate } from "./commands/update.js";
import { createAnthropicClient } from "./agent/llm-client.js";
import type { RunConfig, SchemaDefinition } from "./types.js";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const serpApiKey = process.env.SERPAPI_KEY;

async function loadSchema(schemaPath: string): Promise<SchemaDefinition> {
  const url = pathToFileURL(resolve(schemaPath)).href;
  const mod = await import(url);
  return mod.default as SchemaDefinition;
}

program.name("scrappy").description("AI-powered structured web scraper");

// --- index command: discover all providers via agent loop ---
program
  .command("index")
  .description("Discover providers and build initial CSV via agent loop")
  .requiredOption("-t, --topic <string>", "Research topic")
  .requiredOption("-s, --schema <path>", "Path to schema file")
  .requiredOption("-o, --output <file>", "Output CSV file")
  .option("-d, --max-depth <number>", "Max crawl depth", "3")
  .option("-i, --max-iterations <number>", "Max agent iterations", "40")
  .option("--crawl4ai <url>", "Crawl4AI base URL", "https://crawl.naszilla.ch")
  .action(async (opts) => {
    if (!serpApiKey) { console.error("Missing SERPAPI_KEY"); process.exit(1); }
    if (!anthropicApiKey) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }

    const schemaDef = await loadSchema(opts.schema);
    const config: RunConfig = {
      topic: opts.topic,
      schemaDef,
      maxDepth: parseInt(opts.maxDepth, 10),
      maxIterations: parseInt(opts.maxIterations, 10),
    };

    const dataset = opts.output.replace(/\.csv$/i, "");
    const Database = (await import("better-sqlite3")).default;
    const { mkdirSync } = await import("fs");
    mkdirSync("data", { recursive: true });
    const cliDb = new Database("data/scrappy.db");
    const { initRecordsSchema, appendRecords: appendRec } = await import("./tools/records.js");
    initRecordsSchema(cliDb);
    const records = await runAgent(config, createAnthropicClient(anthropicApiKey!), serpApiKey!, opts.crawl4ai);
    const { written, promoted, skipped } = await appendRec(records, dataset, schemaDef, cliDb);
    console.log(`Done. ${written} records written, ${promoted} promoted to official, ${skipped} duplicates skipped → ${opts.output}`);
  });

// --- update command: re-scrape official URLs and refresh rate fields ---
program
  .command("update")
  .description("Re-scrape official provider pages and update rate fields in existing CSV")
  .requiredOption("-i, --input <file>", "Existing CSV file to update")
  .requiredOption("-s, --schema <path>", "Path to schema file")
  .option("--crawl4ai <url>", "Crawl4AI base URL", "https://crawl.naszilla.ch")
  .action(async (opts) => {
    if (!anthropicApiKey) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }

    const schemaDef = await loadSchema(opts.schema);
    await runUpdate(opts.input, schemaDef, createAnthropicClient(anthropicApiKey!), opts.crawl4ai);
  });

program.parse();
