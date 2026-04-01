import { z } from "zod";
import type { SchemaDefinition } from "../src/types.js";

const schema = z.object({
  kontoName: z.string(),
  bankName: z.string(),
  zinssatz: z.string(),
  gebuehren: z.string().optional(),
  minimaleEinlage: z.string().optional(),
  kontoTyp: z.string().optional(),
  url: z.string().optional(),
});

const schemaDef: SchemaDefinition = {
  schema,
  fieldDescriptions: {
    kontoName: "Full name of the Freizügigkeitskonto product (e.g. 'Freizügigkeitskonto A', 'UBS Freizügigkeit')",
    bankName: "Name of the bank or financial institution offering the account",
    zinssatz: "Annual interest rate as shown by the provider (e.g. '0.50%'). Use the provider's exact notation.",
    gebuehren: "Account fees or charges, if any (e.g. 'keine', 'CHF 30/Jahr', 'gratis')",
    minimaleEinlage: "Minimum deposit or balance required, if stated (e.g. '0 CHF', 'CHF 1')",
    kontoTyp: "Account type if the provider distinguishes between variants (e.g. 'Konto A', 'Konto B', 'Wertschriftendepot')",
    url: "Direct URL to the official provider product page (not the comparison site)",
  },
  dedupeKey: ["kontoName", "bankName"],
  urlField: "url",
  trackedFields: ["zinssatz"],
  namingRules: [
    "kontoName: use the EXACT official product name as shown on the provider's own website. Never invent generic names like \"Freizügigkeitskonto\" unless that is literally what the bank calls it.",
    "bankName: use the bank's common short name without legal suffixes (e.g. \"Migros Bank\" not \"Migros Bank AG\"). Be consistent across all records for the same bank.",
  ],
  seedUrls: [
    "https://www.comparis.ch/vorsorge/freizuegigkeitskonto/vergleich",
    "https://www.moneyland.ch/de/freizuegigkeitskonto-vergleich",
  ],
};

export default schemaDef;
