# CLI Reference

```bash
npm start -- <command> [options]
```

## index

Discover and extract new records for a dataset.

```bash
npm start -- index \
  --topic <string> \
  --schema <path> \
  --output <dataset-name> \
  [--max-iterations <number>] \
  [--max-depth <number>] \
  [--crawl4ai <url>]
```

| Option | Description | Default |
|---|---|---|
| `--topic` | Research topic for the agent | required |
| `--schema` | Path to schema `.ts` file | required |
| `--output` | Dataset name to store results | required |
| `--max-iterations` | Max agent loop iterations | `40` |
| `--max-depth` | Max crawl depth for link following | `3` |
| `--crawl4ai` | Crawl4AI base URL | `https://crawl.naszilla.ch` |

## update

Refresh tracked fields in an existing dataset.

```bash
npm start -- update \
  --input <dataset-name> \
  --schema <path> \
  [--crawl4ai <url>]
```

| Option | Description | Default |
|---|---|---|
| `--input` | Dataset name to update | required |
| `--schema` | Path to schema `.ts` file | required |
| `--crawl4ai` | Crawl4AI base URL | `https://crawl.naszilla.ch` |

> **Filtering** is only available via the REST API (`POST /jobs/update` with a `filter` body param), not the CLI.

## Examples

```bash
# Index mobile plans
npm start -- index \
  --topic "Swiss mobile plans" \
  --schema schemas/mobile.ts \
  --output mobile-plans \
  --max-iterations 60

# Update all rows
npm start -- update \
  --input mobile-plans \
  --schema schemas/mobile.ts
```
