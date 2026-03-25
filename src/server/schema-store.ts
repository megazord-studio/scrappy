import { z } from "zod";
import type Database from "better-sqlite3";
import type { SchemaDefinition } from "../types.js";

export interface FieldDef {
  name: string;
  type: "string";
  optional: boolean;
  description: string;
}

export interface SchemaInput {
  id: string;
  display_name: string;
  fields: FieldDef[];
  dedupe_key: string[];
  url_field: string;
  rate_fields: string[];
  naming_rules?: string[];
  entity_field?: string;
}

interface DbSchemaRow {
  id: string;
  display_name: string;
  fields: string;
  dedupe_key: string;
  url_field: string;
  rate_fields: string;
  naming_rules: string | null;
  entity_field: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDefinition(row: DbSchemaRow): SchemaDefinition {
  const fields: FieldDef[] = JSON.parse(row.fields);
  const fieldDescriptions: Record<string, string> = {};
  const shapeEntries: [string, z.ZodTypeAny][] = [];
  for (const f of fields) {
    shapeEntries.push([f.name, f.optional ? z.string().optional() : z.string()]);
    fieldDescriptions[f.name] = f.description;
  }
  return {
    schema: z.object(Object.fromEntries(shapeEntries)),
    fieldDescriptions,
    dedupeKey: JSON.parse(row.dedupe_key),
    urlField: row.url_field,
    rateFields: JSON.parse(row.rate_fields),
    namingRules: row.naming_rules ? JSON.parse(row.naming_rules) : undefined,
    entityField: row.entity_field ?? undefined,
  };
}

function normalizeId(id: string): string {
  return id.replace(/\.ts$/i, "");
}

export function dbListSchemas(db: Database.Database): { id: string; display_name: string }[] {
  return db.prepare("SELECT id, display_name FROM schemas ORDER BY display_name").all() as { id: string; display_name: string }[];
}

export function dbGetSchemaRow(db: Database.Database, id: string): DbSchemaRow | undefined {
  const nid = normalizeId(id);
  return db.prepare("SELECT * FROM schemas WHERE id = ?").get(nid) as DbSchemaRow | undefined;
}

export function dbGetSchema(db: Database.Database, id: string): SchemaDefinition | undefined {
  const row = dbGetSchemaRow(db, id);
  return row ? rowToDefinition(row) : undefined;
}

export function dbInsertSchema(db: Database.Database, input: SchemaInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO schemas (id, display_name, fields, dedupe_key, url_field, rate_fields, naming_rules, entity_field, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    normalizeId(input.id),
    input.display_name,
    JSON.stringify(input.fields),
    JSON.stringify(input.dedupe_key),
    input.url_field,
    JSON.stringify(input.rate_fields),
    input.naming_rules ? JSON.stringify(input.naming_rules) : null,
    input.entity_field ?? null,
    now,
    now
  );
}

export function dbUpdateSchema(db: Database.Database, id: string, input: Omit<SchemaInput, "id">): void {
  const nid = normalizeId(id);
  db.prepare(
    `UPDATE schemas SET display_name=?, fields=?, dedupe_key=?, url_field=?, rate_fields=?, naming_rules=?, entity_field=?, updated_at=? WHERE id=?`
  ).run(
    input.display_name,
    JSON.stringify(input.fields),
    JSON.stringify(input.dedupe_key),
    input.url_field,
    JSON.stringify(input.rate_fields),
    input.naming_rules ? JSON.stringify(input.naming_rules) : null,
    input.entity_field ?? null,
    new Date().toISOString(),
    nid
  );
}

export function dbDeleteSchema(db: Database.Database, id: string): { deleted: boolean; reason?: string } {
  const nid = normalizeId(id);
  const jobCount = (db.prepare(
    "SELECT COUNT(*) as n FROM jobs WHERE json_extract(params, '$.schema') = ? OR json_extract(params, '$.schema') = ?"
  ).get(nid, nid + ".ts") as { n: number }).n;
  if (jobCount > 0) return { deleted: false, reason: `Referenced by ${jobCount} job(s)` };
  db.prepare("DELETE FROM schemas WHERE id = ?").run(nid);
  return { deleted: true };
}
