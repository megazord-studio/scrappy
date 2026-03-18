# Schemas

A schema tells Scrappy what data to extract and how. It defines the fields, their descriptions for the LLM, deduplication keys, and which fields to refresh during an update job.

## Schema file structure

```typescript
import { z } from "zod";
import type { SchemaDefinition } from "../src/types.js";

const schemaDef: SchemaDefinition = {
  // Zod schema for type validation
  schema: z.object({
    providerName: z.string(),
    planName: z.string(),
    monthlyPrice: z.string(),
    dataVolume: z.string(),
    url: z.string().optional(),
  }),

  // Descriptions passed to the LLM — be precise
  fieldDescriptions: {
    providerName: "Name of the telecom provider (e.g. 'Sunrise', 'Salt', 'Swisscom')",
    planName: "Official name of the mobile plan as shown by the provider",
    monthlyPrice: "Monthly price in CHF (e.g. '29.90' or '19.90–39.90')",
    dataVolume: "Included data volume (e.g. '10 GB', 'unlimited')",
    url: "Direct URL to the official product page (not a comparison site)",
  },

  // Fields used for deduplication — must uniquely identify a record
  dedupeKey: ["providerName", "planName"],

  // Which field stores the official URL (used by update command)
  urlField: "url",

  // Which fields to refresh during an update job
  rateFields: ["monthlyPrice", "dataVolume"],

  // Optional: consistency rules for the LLM
  namingRules: [
    "providerName: use the provider's common short name without legal suffixes (e.g. 'Sunrise' not 'Sunrise Communications AG')",
  ],

  // Optional: URLs to scrape first before any Google searches
  seedUrls: [
    "https://www.comparis.ch/telecom/mobile/vergleich",
  ],
};

export default schemaDef;
```

## Tips

**`fieldDescriptions` quality matters most.** The agent uses these to decide what to extract. Vague descriptions produce inconsistent results. Include examples of expected values in the description itself.

**`dedupeKey` should be stable.** If the agent sometimes writes `"Sunrise GO 10"` and sometimes `"GO 10"`, they won't deduplicate. Use `namingRules` to enforce consistency.

**`rateFields` isn't just for rates.** Any field whose value changes over time and should be refreshed by the update command belongs here — prices, specs, availability, scores, etc.

**Leave `url` blank rather than putting a comparison site URL.** The update command skips the SERP search step if a proper official URL is already stored. Only store the URL when you're confident it points to the official provider page.

## Creating schemas

The primary way to create and edit schemas is the web UI: **Scrape → Schemas → + New Schema**. Schemas are stored in the SQLite database and available immediately to index and update jobs.

TypeScript schema files (like the example above) are also supported for version control workflows. Pass the file path as the `--schema` argument when running via CLI, or select it from the schema dropdown in the UI if it's been loaded into the database.

When editing a schema that's already been used for scraping, be careful changing `dedupeKey` fields — existing records won't automatically re-deduplicate.
