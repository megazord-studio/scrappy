import { z } from "zod";
import type { SchemaDefinition } from "../src/types.js";

const schema = z.object({
  kontoName: z.string(),
  bankName: z.string(),
  zinssatz: z.string(),
  minEinlage: z.string().optional(),
  url: z.string().optional(),
});

const schemaDef: SchemaDefinition = {
  schema,
  fieldDescriptions: {
    kontoName: "Full name of the 3a account/product (e.g. 'UBS Säule 3a', 'Postfinance 3a Konto')",
    bankName: "Name of the bank or financial institution offering the account",
    zinssatz: "Annual interest rate as shown by the provider (e.g. '0.75%' or '0.39%–0.45%' for tiered rates). Use the provider's exact notation.",
    minEinlage: "Minimum deposit required to open the account, if stated (e.g. '0 CHF')",
    url: "Direct URL to the official provider product page (not the comparison site)",
  },
  dedupeKey: ["kontoName", "bankName"],
  urlField: "url",
  trackedFields: ["zinssatz"],
  namingRules: [
    "kontoName: use the EXACT official product name as shown on the provider's own website. If scraping a comparison site, use the name as the provider themselves would use it — not the comparison site's label. Never invent generic names like \"Vorsorgekonto 3a\" unless that is literally what the bank calls it.",
    "bankName: use the bank's common short name without legal suffixes (e.g. \"Tellco\" not \"Tellco AG\", \"Migros Bank\" not \"Migros Bank AG\"). Be consistent across all records for the same bank.",
  ],
};

export default schemaDef;
