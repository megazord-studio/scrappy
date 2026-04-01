import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { appendRecords, createTestDb, readRecords } from "../src/tools/records.js";
import type { SchemaDefinition, CsvRow } from "../src/types.js";

const schemaDef: SchemaDefinition = {
  schema: z.object({
    kontoName: z.string(),
    bankName: z.string(),
    zinssatz: z.string(),
    url: z.string().optional(),
  }),
  fieldDescriptions: { kontoName: "", bankName: "", zinssatz: "", url: "" },
  dedupeKey: ["kontoName", "bankName"],
  urlField: "url",
  trackedFields: ["zinssatz"],
};

function rec(kontoName: string, bankName: string, zinssatz: string, url = "", dataSource = "comparison"): CsvRow {
  return { kontoName, bankName, zinssatz, url, _dataSource: dataSource as "comparison" | "official", _lastUpdated: "2026-01-01" };
}

describe("dedup", () => {
  test("exact duplicate is skipped", async () => {
    const db = createTestDb();
    await appendRecords([rec("Sparen 3 Konto", "ZKB", "1.00", "https://zkb.ch/3a")], "test", schemaDef, db);
    const { written, skipped } = await appendRecords([rec("Sparen 3 Konto", "ZKB", "1.00", "https://zkb.ch/3a")], "test", schemaDef, db);
    assert.equal(written, 0);
    assert.equal(skipped, 1);
    assert.equal(readRecords("test", db).length, 1);
  });

  test("bankName with legal suffix dedupes correctly — Tellco AG vs Tellco (same kontoName)", async () => {
    const db = createTestDb();
    await appendRecords([rec("Tellco 3a Konto", "Tellco AG", "0.45", "https://tellco.ch/saeule3a")], "test", schemaDef, db);
    const { written, skipped } = await appendRecords([rec("Tellco 3a Konto", "Tellco", "0.45", "https://tellco.ch/saeule3a")], "test", schemaDef, db);
    assert.equal(written, 0, "Tellco AG and Tellco should be treated as the same bank");
    assert.equal(skipped, 1);
    assert.equal(readRecords("test", db).length, 1);
  });

  test("different kontoName + different URL same bank is NOT deduped — known limitation", async () => {
    const db = createTestDb();
    await appendRecords([rec("Tellco 3a Konto", "Tellco AG", "0.45", "https://tellco.ch/saeule3a")], "test", schemaDef, db);
    const { written } = await appendRecords([rec("Vorsorgekonto 3a", "Tellco", "0.45", "https://tellco.ch/vorsorge")], "test", schemaDef, db);
    assert.equal(written, 1, "KNOWN LIMITATION: different kontoName + different URL is not deduped");
    assert.equal(readRecords("test", db).length, 2);
  });

  test("Neon: multiple products on same URL are kept separately", async () => {
    const db = createTestDb();
    await appendRecords([
      rec("Neon 3a Konto",   "Neon", "1.00", "https://neon-free.ch/3a"),
      rec("Neon 3a Plus",    "Neon", "1.20", "https://neon-free.ch/3a"),
      rec("Neon 3a Premium", "Neon", "1.50", "https://neon-free.ch/3a"),
    ], "test", schemaDef, db);
    assert.equal(readRecords("test", db).length, 3, "All 3 Neon products should be kept");
  });

  test("ZKB: two distinct products are kept separately", async () => {
    const db = createTestDb();
    await appendRecords([
      rec("Sparen 3 Konto", "ZKB", "0.85", "https://www.zkb.ch/de/private/vorsorge/3saeule-freizuegigkeit/saeule-3a-konto.html"),
      rec("Sparen 3 Fonds", "ZKB", "0.00", "https://www.zkb.ch/de/private/vorsorge/3saeule-freizuegigkeit/saeule-3a-fonds.html"),
    ], "test", schemaDef, db);
    assert.equal(readRecords("test", db).length, 2, "Two ZKB products should be kept separately");
  });

  test("Valiant: legal suffix normalization", async () => {
    const db = createTestDb();
    await appendRecords([rec("Valiant 3a Konto", "Valiant Bank AG", "0.75", "https://valiant.ch/3a")], "test", schemaDef, db);
    const { written } = await appendRecords([rec("Valiant 3a Konto", "Valiant Bank", "0.75", "https://valiant.ch/3a")], "test", schemaDef, db);
    assert.equal(written, 0, "Valiant Bank AG and Valiant Bank should be treated as the same bank");
    assert.equal(readRecords("test", db).length, 1);
  });

  test("official source overwrites comparison source for same key", async () => {
    const db = createTestDb();
    await appendRecords([rec("Sparen 3 Konto", "ZKB", "0.80", "https://zkb.ch/3a", "comparison")], "test", schemaDef, db);
    const { written, skipped } = await appendRecords([rec("Sparen 3 Konto", "ZKB", "0.85", "https://zkb.ch/3a", "official")], "test", schemaDef, db);
    assert.equal(written, 0, "Official duplicate should be skipped by appendRecords (update via updateRecords)");
    assert.equal(skipped, 1);
  });

  test("same URL + same rate + same bank dedupes even with different kontoName", async () => {
    const db = createTestDb();
    await appendRecords([rec("Tellco 3a Konto", "Tellco AG", "0.45", "https://tellco.ch/saeule3a")], "test", schemaDef, db);
    const { written, skipped } = await appendRecords([rec("Vorsorgekonto 3a", "Tellco", "0.45", "https://tellco.ch/saeule3a")], "test", schemaDef, db);
    assert.equal(written, 0, "Same bank+URL+rate should be deduped even with different kontoName");
    assert.equal(skipped, 1);
    assert.equal(readRecords("test", db).length, 1);
  });

  test("same URL with /de/ language prefix vs without dedupes (Valiant case)", async () => {
    const db = createTestDb();
    await appendRecords([rec("Valiant 3a Konto", "Valiant Bank", "0.20", "https://www.valiant.ch/de/privatkunden/privor-vorsorgekonto-3a")], "test", schemaDef, db);
    const { written, skipped } = await appendRecords([rec("Privor Vorsorgekonto 3a", "Valiant Bank", "0.20", "https://www.valiant.ch/privatkunden/privor-vorsorgekonto-3a")], "test", schemaDef, db);
    assert.equal(written, 0, "Same page with /de/ prefix should be deduped");
    assert.equal(skipped, 1);
    assert.equal(readRecords("test", db).length, 1);
  });

  test("same URL + same bank but DIFFERENT rate is kept (e.g. Neon tiers)", async () => {
    const db = createTestDb();
    await appendRecords([rec("Neon 3a Basic", "Neon", "0.75", "https://neon.ch/3a")], "test", schemaDef, db);
    const { written } = await appendRecords([rec("Neon 3a Plus", "Neon", "1.00", "https://neon.ch/3a")], "test", schemaDef, db);
    assert.equal(written, 1, "Same bank+URL but different rate should be kept");
    assert.equal(readRecords("test", db).length, 2);
  });

  test("Cler pattern: same bank (normalized), different kontoName + different URL is NOT auto-deduped", async () => {
    const db = createTestDb();
    await appendRecords([rec("Bank Cler 3a Konto", "Bank Cler AG", "0.20%", "https://www.cler.ch/de/info/zinssatze")], "test", schemaDef, db);
    const { written } = await appendRecords([rec("Bank Cler Vorsorgekonto 3", "Bank Cler", "0.20%", "https://www.cler.ch/de/vorsorgen/vorsorgekonto-3")], "test", schemaDef, db);
    assert.equal(written, 1, "Different URL + different kontoName is not auto-deduped (requires manual merge in UI)");
    assert.equal(readRecords("test", db).length, 2);
  });

  test("Cler pattern: same bank + same URL + same rate (different kontoName) IS deduped", async () => {
    const db = createTestDb();
    await appendRecords([rec("Bank Cler 3a Konto", "Bank Cler AG", "0.20%", "https://www.cler.ch/de/vorsorgen/vorsorgekonto-3")], "test", schemaDef, db);
    const { written, skipped } = await appendRecords([rec("Bank Cler Vorsorgekonto 3", "Bank Cler", "0.20%", "https://www.cler.ch/de/vorsorgen/vorsorgekonto-3")], "test", schemaDef, db);
    assert.equal(written, 0, "Same bank+URL+rate should be deduped even with different kontoName");
    assert.equal(skipped, 1);
  });

  test("case-insensitive dedup", async () => {
    const db = createTestDb();
    await appendRecords([rec("Sparen 3 Konto", "Raiffeisen", "0.70")], "test", schemaDef, db);
    const { written } = await appendRecords([rec("sparen 3 konto", "RAIFFEISEN", "0.70")], "test", schemaDef, db);
    assert.equal(written, 0, "Dedup should be case-insensitive");
  });
});
