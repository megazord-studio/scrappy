import type { Job, Schema, Settings, RecordsResponse } from './types';

let _apiKey = '';
export function setApiKey(key: string) { _apiKey = key; }
function authHeaders(): Record<string, string> {
  return _apiKey ? { 'Authorization': `Bearer ${_apiKey}` } : {};
}

export async function getJobs(): Promise<{ jobs: Job[] }> {
  return fetch('/jobs').then(r => r.json());
}

export async function getJob(id: string): Promise<Job> {
  return fetch(`/jobs/${id}`).then(r => r.json());
}

export async function getJobEvents(id: string): Promise<{ events: Array<{ type: string; payload: Record<string, unknown>; ts: string }> }> {
  return fetch(`/jobs/${id}/events`).then(r => r.json());
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(`/jobs/${id}/cancel`, { method: 'POST' });
}

export async function clearJobs(): Promise<void> {
  await fetch('/jobs/clear', { method: 'POST' });
}

export async function startIndexJob(body: {
  topic: string;
  schema: string;
  output: string;
  maxIterations?: string;
  seedUrls?: string;
}): Promise<{ id: string; error?: string }> {
  return fetch('/jobs/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

export async function startUpdateJob(body: {
  input: string;
  schema: string;
  filter?: string;
}): Promise<{ id: string; error?: string }> {
  return fetch('/jobs/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

export async function getSchemas(): Promise<{ schemas: Schema[] }> {
  return fetch('/schemas').then(r => r.json());
}

export async function getSchema(id: string): Promise<Schema> {
  return fetch(`/schemas/${id}`).then(r => r.json());
}

export async function saveSchema(body: Record<string, unknown>, editingId: string | null): Promise<{ error?: string }> {
  const method = editingId ? 'PUT' : 'POST';
  const url = editingId ? `/schemas/${editingId}` : '/schemas';
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json().then(data => ({ ...data, ok: r.ok, status: r.status })));
}

export async function deleteSchema(id: string): Promise<{ error?: string }> {
  return fetch(`/schemas/${id}`, { method: 'DELETE' }).then(r => r.json());
}

export async function getOutputs(): Promise<{ outputs: string[] }> {
  return fetch('/outputs').then(r => r.json());
}

export async function getRecords(file: string): Promise<RecordsResponse> {
  return fetch(`/outputs/${file}/records?limit=200`).then(r => r.json());
}

export async function mergeRows(file: string, keepId: number, removeIds: number[]): Promise<Response> {
  return fetch(`/outputs/${file}/merge-rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepId, removeIds }),
  });
}

export async function markNotDuplicate(file: string, ids: number[]): Promise<Response> {
  return fetch(`/outputs/${file}/not-duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function dedupeOutput(file: string): Promise<void> {
  await fetch(`/outputs/${file}/dedupe`, { method: 'POST' });
}

export async function deleteOutput(file: string): Promise<void> {
  await fetch(`/outputs/${file}`, { method: 'DELETE' });
}

export async function getSettings(): Promise<Settings> {
  const s: Settings = await fetch('/settings').then(r => r.json());
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
