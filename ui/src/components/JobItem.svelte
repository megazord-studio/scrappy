<script lang="ts">
  import type { Job } from '../lib/types';
  import { timeAgo, getJobLabel } from '../lib/format';

  const {
    job,
    selected,
    onclick,
    onCancel,
  }: {
    job: Job;
    selected: boolean;
    onclick: () => void;
    onCancel: () => void;
  } = $props();

  const title = $derived(getJobLabel(job));

  const metaParts = $derived([
    job.type,
    job.params.schema,
    job.params.filter,
    timeAgo(job.startedAt),
  ].filter(Boolean).join(' · '));
</script>

<div
  class="job-item"
  class:selected
  onclick={(e) => {
    if ((e.target as HTMLElement).closest('.cancel-btn')) return;
    onclick();
  }}
>
  <div class="job-header">
    <span class="job-title">
      {#if job.status === 'running'}
        <span class="spinner"></span>
      {/if}
      {title}
    </span>
    <div style="display:flex;align-items:center;gap:0.35rem">
      {#if job.status === 'running'}
        <button
          class="cancel-btn"
          title="Cancel"
          onclick={(e) => { e.stopPropagation(); onCancel(); }}
        >×</button>
      {/if}
      <span class="badge {job.status}">{job.status}</span>
    </div>
  </div>
  <div class="job-meta">{metaParts}</div>
</div>
