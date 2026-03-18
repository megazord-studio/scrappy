# Index Jobs

An index job discovers and extracts new records for a dataset.

## Parameters

| Parameter | Description | Default |
|---|---|---|
| `topic` | Research topic passed to the agent | required |
| `schema` | Schema to use for extraction | required |
| `output` | Dataset name for results | required |
| `maxIterations` | Maximum agent loop iterations | 40 |
| `seedUrls` | URLs to scrape first, before any searches | — |

## Getting more results

### Increase maxIterations

Each iteration is one LLM decision round — more iterations means more searches and scrapes. Set it to 80–120 for thorough coverage.

### Add seedUrls to your schema

The biggest practical win. Point the agent directly at known comparison portals so it doesn't spend iterations finding them:

```typescript
const schemaDef: SchemaDefinition = {
  // ...
  seedUrls: [
    "https://www.comparis.ch/telecom/mobile/vergleich",
    "https://www.moneyland.ch/de/3a-konto-vergleich",
  ],
};
```

### Run multiple times on the same dataset

You can run the same index job repeatedly with different seed URLs or topic phrasings and point them all at the same output dataset. Deduplication runs at write time — new records are merged in, duplicates are skipped.

```bash
# First pass — comparison portals
npm start -- index --topic "Swiss mobile plans 2025" --schema schemas/mobile.ts --output mobile-plans

# Second pass — different angle, same dataset
npm start -- index --topic "Schweizer Mobilabo Vergleich Preise" --schema schemas/mobile.ts --output mobile-plans
```

## How the agent decides to stop

The agent is blocked from calling `finish` until it has scraped at least `min(15, maxIterations × 0.6)` pages. This prevents it from finishing too early on a broad topic.

## Record tagging

Every record gets:

- `_dataSource`: `"comparison"` or `"official"` — where it was extracted from
- `_lastUpdated`: ISO date of extraction

When the same record is found on both a comparison site and an official page, the official version is kept and any blank fields are filled from the comparison version.
