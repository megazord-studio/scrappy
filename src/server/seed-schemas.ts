import { readdirSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { SchemaDefinition } from "../types.js";
import { dbInsertSchema, type FieldDef } from "./schema-store.js";

export async function seedSchemasFromFiles(db: Database.Database): Promise<void> {
  const count = (db.prepare("SELECT COUNT(*) as n FROM schemas").get() as { n: number }).n;
  if (count > 0) return;

  let files: string[];
  try {
    files = readdirSync("schemas").filter((f) => f.endsWith(".ts"));
  } catch {
    return;
  }

  for (const file of files) {
    const url = pathToFileURL(resolve("schemas", file)).href;
    try {
      const mod = await import(url);
      const def: SchemaDefinition = mod.default;
      const id = file.replace(/\.ts$/, "");

      const fields: FieldDef[] = Object.entries(def.schema.shape).map(([name, zodType]) => ({
        name,
        type: "string" as const,
        optional: zodType instanceof z.ZodOptional,
        description: def.fieldDescriptions[name] ?? "",
      }));

      dbInsertSchema(db, {
        id,
        display_name: id,
        fields,
        dedupe_key: def.dedupeKey,
        url_field: def.urlField,
        tracked_fields: def.trackedFields,
        naming_rules: def.namingRules,
      });
    } catch (err) {
      console.warn(`[seed-schemas] skipping ${file}:`, err);
    }
  }
}
