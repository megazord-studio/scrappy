import { z } from "zod";

export interface SchemaDefinition {
  schema: z.ZodObject<z.ZodRawShape>;
  /** Description of each field to guide the LLM during extraction */
  fieldDescriptions: Record<string, string>;
  /** Field(s) used as deduplication key */
  dedupeKey: string[];
  /** Which field contains the official provider URL to scrape during update */
  urlField: string;
  /** Which field contains the rate(s) to refresh during update */
  rateFields: string[];
  /** Optional naming/consistency rules passed to the LLM during extraction (e.g. how to normalise names) */
  namingRules?: string[];
}

export interface RunConfig {
  topic: string;
  schemaDef: SchemaDefinition;
  maxDepth: number;
  maxIterations: number;
  /** URLs to scrape first, before the agent starts searching */
  seedUrls?: string[];
}

export interface PageLink {
  url: string;
  text: string;
}

export interface ScrapeResult {
  url: string;
  markdown: string;
  links: PageLink[];
}

export type ExtractedRecord = Record<string, unknown>;

/** System columns added automatically by scrappy, not part of user schema */
export interface SystemColumns {
  _dataSource: "comparison" | "official";
  _lastUpdated: string; // ISO date
}

export type CsvRow = ExtractedRecord & Partial<SystemColumns>;

export type EmitFn = (type: string, payload: Record<string, unknown>) => void;
