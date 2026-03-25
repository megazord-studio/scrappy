import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { RunConfig } from "../types.js";

export function buildTools(schemaDef: RunConfig["schemaDef"]): Anthropic.Tool[] {
  const fieldDescriptions = Object.entries(schemaDef.fieldDescriptions)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  // Required identity fields = dedupeKey fields that are not optional in the schema
  const requiredDedupeFields = schemaDef.dedupeKey.filter(f => {
    const shape = schemaDef.schema.shape[f];
    return shape && !(shape instanceof z.ZodOptional);
  });
  const identityFields = requiredDedupeFields.length > 0 ? requiredDedupeFields : schemaDef.dedupeKey;

  return [
    {
      name: "search_google",
      description: "Search Google and return a list of relevant URLs for the given query.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
    {
      name: "scrape_url",
      description:
        "Scrape a URL using Crawl4AI and return its markdown content plus any links found on the page.",
      input_schema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "The URL to scrape" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_structured_data",
      description: `Save structured records you have extracted from a scraped page. Call this after every scrape, even if you found 0 records — pass an empty array if nothing matched.

Target schema fields:
${fieldDescriptions}

${schemaDef.namingRules && schemaDef.namingRules.length > 0 ? `Naming rules (critical for deduplication):\n${schemaDef.namingRules.map((r) => `- ${r}`).join("\n")}\n\n` : ""}Rules:
- Save a record whenever the required identity fields (${identityFields.join(", ")}) are clearly found on the page — even if other fields are missing. Leave missing fields as empty string "". Missing fields will be filled in later by an update job.
- Extract ALL matching entities on the page, not just the ones most related to the research topic. The topic guides your searches; extraction is purely schema-driven.
- Never guess or invent values — only include what is clearly stated. The identity fields must be accurate.
- One record per distinct product or entity
- If a field has tiered values (e.g. varies by balance tier), capture them in a single record using the provider's own notation (e.g. "0.39%–0.75%" or "from 0.39%") — do NOT create separate records per tier
- URL field: use the provider's own official page URL if known; leave blank rather than using a comparison site URL`,
      input_schema: {
        type: "object" as const,
        properties: {
          source_url: {
            type: "string",
            description: "The URL the records were extracted from",
          },
          records: {
            type: "array",
            description: "The extracted records matching the schema",
            items: {
              type: "object",
              properties: Object.fromEntries(
                Object.keys(schemaDef.schema.shape).map((k) => [k, { type: "string" }])
              ),
            },
          },
        },
        required: ["source_url", "records"],
      },
    },
    {
      name: "finish",
      description:
        "Call this when you have collected all available data and are confident in the results. You must estimate how many total results exist for this topic before finishing — use your searches and scrapes to inform this estimate.",
      input_schema: {
        type: "object" as const,
        properties: {
          records: {
            type: "array",
            description: "All extracted records",
            items: { type: "object" },
          },
          estimated_total: {
            type: "number",
            description: "Your estimate of how many total results exist for this topic (not just what you found — how many exist in total). Base this on what you saw across comparison pages, search results, and provider pages.",
          },
        },
        required: ["records", "estimated_total"],
      },
    },
  ];
}
