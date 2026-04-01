import type { CsvRow, SchemaDefinition } from "../types.js";
import type { LLMClient } from "./llm-client.js";

// ─── Issue types ─────────────────────────────────────────────────────────────

export interface QaIssueFuzzyDupe {
  type: "fuzzy_dupe";
  ids: number[];
  confidence: number; // 0–1
  reason: string;
}

export interface QaIssueNormalization {
  type: "normalization";
  id: number;
  field: string;
  current: string;
  suggested: string;
  reason: string;
}

export interface QaIssueOutlier {
  type: "outlier";
  id: number;
  field: string;
  value: string;
  reason: string;
}

export type QaIssue = QaIssueFuzzyDupe | QaIssueNormalization | QaIssueOutlier;

// ─── Tool definition ──────────────────────────────────────────────────────────

const reportIssuesTool = {
  name: "report_issues",
  description: "Report all data quality issues found. Call this exactly once with all issues.",
  input_schema: {
    type: "object" as const,
    properties: {
      issues: {
        type: "array",
        description: "List of data quality issues. Empty array if none found.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["fuzzy_dupe", "normalization", "outlier"],
              description: "Issue category",
            },
            // fuzzy_dupe fields
            ids: {
              type: "array",
              items: { type: "number" },
              description: "Record _id values that are likely duplicates (fuzzy_dupe only)",
            },
            confidence: {
              type: "number",
              description: "Confidence score 0–1 (fuzzy_dupe only)",
            },
            // normalization / outlier shared
            id: {
              type: "number",
              description: "Record _id (normalization and outlier only)",
            },
            field: {
              type: "string",
              description: "Field name with the issue",
            },
            // normalization
            current: {
              type: "string",
              description: "Current field value (normalization only)",
            },
            suggested: {
              type: "string",
              description: "Suggested normalized value (normalization only)",
            },
            // outlier
            value: {
              type: "string",
              description: "The problematic value (outlier only)",
            },
            // shared
            reason: {
              type: "string",
              description: "Brief explanation of why this is an issue",
            },
          },
          required: ["type", "reason"],
        },
      },
    },
    required: ["issues"],
  },
};

// ─── System prompt ────────────────────────────────────────────────────────────

function buildQaPrompt(schemaDef: SchemaDefinition): string {
  const fieldLines = Object.entries(schemaDef.fieldDescriptions)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  const trackedFields = schemaDef.trackedFields.length
    ? schemaDef.trackedFields.join(", ")
    : "(none)";
  const nameFields = schemaDef.dedupeKey.join(", ");
  const namingRules = schemaDef.namingRules?.length
    ? schemaDef.namingRules.map((r) => `  - ${r}`).join("\n")
    : "  (none)";

  return `You are a data quality checker for structured datasets. Review the provided records and report issues using the report_issues tool.

## Schema
${fieldLines}

## Field categories
- Name/entity fields (check for inconsistent casing, spelling variants, abbreviations): ${nameFields}
- Tracked fields (check for wrong units, impossible values, format inconsistencies): ${trackedFields}

## Naming rules
${namingRules}

## What to report

**fuzzy_dupe** — records that are the same real-world entity but passed exact deduplication.
Look for: same domain in URL but slightly different name, same rates with minor name variation, clear abbreviations of the same name.
Only report pairs/groups you are confident are duplicates (confidence ≥ 0.75).

**normalization** — a value is valid but formatted inconsistently relative to other records in the same field.
Examples: "2,5%" vs "2.5" in a rate field, "UBS AG" vs "ubs" in a name field, "CHF 1'200" vs "1200" in a numeric field.
Only report when there are multiple records with different formats for the same logical value type.

**outlier** — a value is clearly wrong or impossible.
Examples: interest rate of 125%, a URL in a name field, a date of year 2099, a negative percentage where only positives make sense.

## Rules
- Only report high-confidence issues. When in doubt, omit.
- Do not flag legitimate data variation (different products genuinely have different rates).
- Do not report missing/blank fields as outliers — blanks are expected.
- Be specific in the reason field.`;
}

// ─── Agent call ───────────────────────────────────────────────────────────────

const MAX_RECORDS = 300;

export async function runQaAgent(
  records: CsvRow[],
  schemaDef: SchemaDefinition,
  llmClient: LLMClient,
): Promise<QaIssue[]> {
  // Include only _id + schema fields (drop system columns that aren't useful for QA)
  const schemaFields = Object.keys(schemaDef.schema.shape);
  const slim = records.slice(0, MAX_RECORDS).map((r) => {
    const out: Record<string, unknown> = { _id: r._id };
    for (const f of schemaFields) out[f] = r[f] ?? null;
    return out;
  });

  const response = await llmClient.messages.create({
    model: llmClient.extractModel,
    max_tokens: 4096,
    system: buildQaPrompt(schemaDef),
    tools: [reportIssuesTool],
    tool_choice: { type: "tool", name: "report_issues" },
    messages: [
      {
        role: "user",
        content: `Review these ${slim.length} records for data quality issues:\n\n${JSON.stringify(slim)}`,
      },
    ],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") return [];

  const input = toolBlock.input as { issues?: unknown[] };
  const raw = Array.isArray(input.issues) ? input.issues : [];
  return raw.filter(isValidQaIssue);
}

function isValidQaIssue(item: unknown): item is QaIssue {
  if (typeof item !== "object" || item === null) return false;
  const o = item as Record<string, unknown>;
  if (!["fuzzy_dupe", "normalization", "outlier"].includes(o.type as string)) return false;
  if (typeof o.reason !== "string") return false;
  if (o.type === "fuzzy_dupe") return Array.isArray(o.ids) && o.ids.length >= 2;
  if (o.type === "normalization") return typeof o.id === "number" && typeof o.field === "string";
  if (o.type === "outlier") return typeof o.id === "number" && typeof o.field === "string";
  return false;
}
