export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function fmtK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n);
}

export function shortUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40);
  } catch {
    return url.slice(0, 50);
  }
}

export function getJobLabel(job: { type: string; params: { topic?: string; schema?: string; input?: string; [key: string]: unknown } }): string {
  return job.type === 'index'
    ? (job.params.topic ?? job.params.schema ?? 'index')
    : `update: ${job.params.input ?? ''}`;
}
