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
  [--seed-urls <url> ...]
```

| Option | Description | Default |
|---|---|---|
| `--topic` | Research topic for the agent | required |
| `--schema` | Path to schema `.ts` file | required |
| `--output` | Dataset name for results | required |
| `--max-iterations` | Max agent loop iterations | `40` |

## update

Refresh tracked fields in an existing dataset.

```bash
npm start -- update \
  --input <dataset-name> \
  --schema <path> \
  [--filter <string>]
```

| Option | Description |
|---|---|
| `--input` | Dataset name to update |
| `--schema` | Path to schema `.ts` file |
| `--filter` | Only update rows where dedupeKey fields contain this string |

## Examples

```bash
# Index Swiss 3a accounts
npm start -- index \
  --topic "Swiss Säule 3a accounts interest rates" \
  --schema schemas/3a-konto.ts \
  --output 3a-konto \
  --max-iterations 60

# Update all rows
npm start -- update \
  --input 3a-konto \
  --schema schemas/3a-konto.ts

# Update only UBS
npm start -- update \
  --input 3a-konto \
  --schema schemas/3a-konto.ts \
  --filter "UBS"
```
