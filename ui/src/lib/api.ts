import type { Job, Schema, Settings, RecordsResponse, Entity, EntityDataset } from './types';

let _apiKey = '';
export function setApiKey(key: string) { _apiKey = key; }
function authHeaders(): Record<string, string> {
  return _apiKey ? { 'Authorization': `Bearer ${_apiKey}` } : {};
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const body = await r.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* use status text */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export async function getJobs(): Promise<{ jobs: Job[] }> {
  return apiFetch('/jobs');
}

export async function getJob(id: string): Promise<Job> {
  return apiFetch(`/jobs/${id}`);
}

export async function getJobEvents(id: string): Promise<{ events: Array<{ type: string; payload: Record<string, unknown>; ts: string }> }> {
  return apiFetch(`/jobs/${id}/events`);
}

export async function cancelJob(id: string): Promise<void> {
  await apiFetch(`/jobs/${id}/cancel`, { method: 'POST' });
}

export async function clearJobs(): Promise<void> {
  await apiFetch('/jobs/clear', { method: 'POST' });
}

export async function startIndexJob(body: {
  topic: string;
  schema: string;
  output: string;
  maxIterations?: number;
  seedUrls?: string;
}): Promise<{ id: string; error?: string }> {
  return apiFetch('/jobs/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
}

export async function startUpdateJob(body: {
  input: string;
  schema: string;
  filter?: string;
  recordId?: number;
  deepSearch?: boolean;
}): Promise<{ id: string; error?: string }> {
  return apiFetch('/jobs/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
}

export async function getSchemas(): Promise<{ schemas: Schema[] }> {
  return apiFetch('/schemas');
}

export async function getSchema(id: string): Promise<Schema> {
  return apiFetch(`/schemas/${id}`);
}

export async function saveSchema(body: Record<string, unknown>, editingId: string | null): Promise<{ error?: string }> {
  const method = editingId ? 'PUT' : 'POST';
  const url = editingId ? `/schemas/${editingId}` : '/schemas';
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().then(data => ({ ...data, ok: r.ok, status: r.status }));
}

export async function deleteSchema(id: string): Promise<{ error?: string }> {
  return apiFetch(`/schemas/${id}`, { method: 'DELETE' });
}

export async function getOutputs(): Promise<{ outputs: string[] }> {
  return apiFetch('/outputs');
}

export async function getDatasetSchema(dataset: string): Promise<string | null> {
  try {
    const res: { schemaId: string | null } = await apiFetch(`/outputs/${encodeURIComponent(dataset)}/schema`);
    return res.schemaId;
  } catch {
    return null;
  }
}

export async function getRecords(file: string): Promise<RecordsResponse> {
  return apiFetch(`/outputs/${file}/records?limit=200`);
}

export async function mergeRows(file: string, keepId: number, removeIds: number[]): Promise<void> {
  await apiFetch(`/outputs/${file}/merge-rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepId, removeIds }),
  });
}

export async function markNotDuplicate(file: string, ids: number[]): Promise<void> {
  await apiFetch(`/outputs/${file}/not-duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function dedupeOutput(file: string): Promise<{ before: number; after: number; removed: number }> {
  return apiFetch(`/outputs/${file}/dedupe`, { method: 'POST' });
}

export async function deleteRecords(file: string, ids: number[]): Promise<void> {
  await apiFetch(`/outputs/${file}/records`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function deleteOutput(file: string): Promise<void> {
  await apiFetch(`/outputs/${file}`, { method: 'DELETE' });
}

export async function getSettings(): Promise<Settings> {
  const s = await apiFetch<Settings>('/settings');
  if (s.apiKey) setApiKey(s.apiKey);
  return s;
}

export async function saveSettings(body: Settings): Promise<Response> {
  return fetch('/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getEntities(): Promise<{ entities: Entity[] }> {
  return apiFetch('/entities');
}

export async function getEntityRecords(key: string): Promise<{ display_name: string; datasets: EntityDataset[] }> {
  return apiFetch(`/entities/${encodeURIComponent(key)}/records`);
}

export async function saveEntity(key: string, body: { display_name: string; description?: string; logo_url?: string; external_url?: string }): Promise<Entity> {
  return apiFetch(`/entities/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteEntity(key: string): Promise<void> {
  await apiFetch(`/entities/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// ─── QA ──────────────────────────────────────────────────────────────────────

export interface QaStoredIssue {
  id: number;
  dataset: string;
  ran_at: string;
  type: 'fuzzy_dupe' | 'normalization' | 'outlier';
  record_ids: number[];
  field: string | null;
  payload: {
    type: string;
    reason: string;
    // fuzzy_dupe
    ids?: number[];
    confidence?: number;
    // normalization
    id?: number;
    field?: string;
    current?: string;
    suggested?: string;
    // outlier
    value?: string;
  };
  status: string;
}

export async function runQa(dataset: string): Promise<{ ran_at: string; count: number; issues: QaStoredIssue[] }> {
  return apiFetch(`/outputs/${encodeURIComponent(dataset)}/qa`, { method: 'POST' });
}

export async function getQaIssues(dataset: string, status = 'open'): Promise<{ issues: QaStoredIssue[] }> {
  return apiFetch(`/outputs/${encodeURIComponent(dataset)}/qa?status=${status}`);
}

export async function patchRecordField(dataset: string, recordId: number, field: string, value: string): Promise<void> {
  await apiFetch(`/outputs/${encodeURIComponent(dataset)}/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, value }),
  });
}

export async function updateQaIssue(dataset: string, issueId: number, status: string): Promise<void> {
  await apiFetch(`/outputs/${encodeURIComponent(dataset)}/qa/${issueId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function generateSchema(description: string): Promise<{
  reply: string;
  schema: {
    id: string;
    display_name: string;
    fields: Array<{ name: string; optional: boolean; description: string }>;
    url_field: string;
    dedupe_key: string[];
    tracked_fields: string[];
    naming_rules: string[];
  };
  error?: string;
}> {
  const res = await fetch('/chat/schema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  return res.json();
}

export async function sendChat(
  message: string,
  jobId?: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ reply?: string; error?: string }> {
  const res = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, jobId, history }),
  });
  try {
    return await res.json();
  } catch {
    return { error: `Server error (${res.status} ${res.statusText})` };
  }
}
