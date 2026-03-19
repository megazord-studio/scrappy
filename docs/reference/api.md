# API Reference

Scrappy exposes a REST API for reading datasets and triggering jobs from external systems.

## Authentication

Job trigger endpoints require an API key. Read endpoints are open.

Pass the key as a Bearer token:

```
Authorization: Bearer YOUR_API_KEY
```

The API key is auto-generated on first server start and visible in **Settings → API**.

---

## Read data

### `GET /outputs/:dataset/records`

Returns records from a dataset as JSON. No authentication required.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 100 | Max rows to return (max 1000) |
| `offset` | integer | 0 | Row offset for pagination |
| `sort` | string | — | Field name to sort by |
| `order` | `asc` / `desc` | `asc` | Sort direction |
| `filter[field]` | string | — | Exact match on a field value |

**Response**

```json
{
  "headers": ["bankName", "zinssatz", "url"],
  "rows": [
    { "bankName": "UBS", "zinssatz": "0.75%", "url": "https://..." },
    ...
  ],
  "total": 142,
  "limit": 100,
  "offset": 0
}
```

**Examples**

```js
// All records, sorted by rate descending
fetch('/outputs/3a-rates/records?sort=zinssatz&order=desc')

// Paginate through large datasets
fetch('/outputs/3a-rates/records?limit=50&offset=50')

// Filter by bank name
fetch('/outputs/3a-rates/records?filter[bankName]=UBS')
```

---

## Trigger jobs

### `POST /jobs/update`

Re-scrapes official URLs and refreshes tracked fields for an existing dataset.

**Headers**
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**Body**

```json
{
  "input": "3a-rates",
  "schema": "3a-konto",
  "filter": "UBS"
}
```

| Field | Required | Description |
|---|---|---|
| `input` | yes | Dataset name to update |
| `schema` | yes | Schema ID to use |
| `filter` | no | Only update rows matching this string in dedupeKey fields |

**Response**

```json
{ "id": "job-uuid" }
```

### `POST /jobs/index`

Starts a new index (discovery) job.

**Body**

```json
{
  "topic": "Swiss Säule 3a accounts",
  "schema": "3a-konto",
  "output": "3a-rates",
  "maxIterations": "60",
  "seedUrls": "https://www.moneyland.ch/de/3a-konto-vergleich"
}
```

| Field | Required | Description |
|---|---|---|
| `topic` | yes | Research topic for the agent |
| `schema` | yes | Schema ID to use |
| `output` | yes | Dataset name to write results to |
| `maxIterations` | no | Max agent loop iterations (default: 40) |
| `seedUrls` | no | Comma-separated URLs to scrape first |

---

## Check job status

### `GET /jobs/:id`

Returns the current status of a job.

```json
{
  "id": "uuid",
  "type": "update",
  "status": "done",
  "result": "Update complete for 3a-rates",
  "startedAt": "2026-03-18T10:00:00.000Z",
  "finishedAt": "2026-03-18T10:04:32.000Z",
  "params": { "input": "3a-rates", "schema": "3a-konto" }
}
```

Status values: `running` · `done` · `failed` · `cancelled`

---

## Outbound webhook

When a job finishes, Scrappy posts to the configured **Webhook URL** (Settings → API).

**Payload**

```json
{
  "event": "job.finished",
  "jobId": "uuid",
  "type": "update",
  "status": "done",
  "result": "Update complete for 3a-rates",
  "finishedAt": "2026-03-18T10:04:32.000Z",
  "params": { "input": "3a-rates", "schema": "3a-konto" }
}
```

The request is fire-and-forget with a 5-second timeout. Use this to invalidate a cache or kick off a Zapier/Make flow.

---

## Triggering updates from Zapier / Make

Use an HTTP action with:

- **Method:** POST
- **URL:** `https://your-scrappy-instance.com/jobs/update`
- **Headers:** `Authorization: Bearer YOUR_API_KEY`, `Content-Type: application/json`
- **Body:** `{ "input": "3a-rates", "schema": "3a-konto" }`

Then add a second step that polls `GET /jobs/:id` until `status` is `done`, or configure the webhook URL in Scrappy settings to receive a push notification instead.
