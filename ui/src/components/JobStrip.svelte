<script lang="ts">
  import type { Job } from '../lib/types';
  import { timeAgo } from '../lib/format';
  import { cancelJob } from '../lib/api';
  import { jobsStore } from '../stores/jobs.svelte';
  import { dashStore } from '../stores/dashboard.svelte';

  const { onClearJobs }: { onClearJobs: () => void } = $props();

  async function handleCancel(id: string, e: MouseEvent) {
    e.stopPropagation();
    await cancelJob(id);
    await jobsStore.refresh();
  }

  function label(j: Job) {
    return j.type === 'index' ? (j.params.topic ?? j.params.schema ?? 'index') : `update: ${j.params.input ?? ''}`;
  }
</script>

<div class="strip">
  <div class="strip-jobs">
    {#if jobsStore.jobs.length === 0}
      <span class="strip-empty">No jobs</span>
    {:else}
      {#each jobsStore.jobs as j (j.id)}
        <div class="strip-job-wrap">
          <button
            class="strip-job"
            class:selected={j.id === jobsStore.selectedJobId}
            onclick={() => dashStore.openJob(j.id)}
            title={label(j)}
          >
            {#if j.status === 'running'}
              <span class="spinner"></span>
            {/if}
            <span class="strip-label">{label(j)}</span>
            <span class="badge {j.status}">{j.status}</span>
            <span class="strip-age">{timeAgo(j.startedAt)}</span>
          </button>
          {#if j.status === 'running'}
            <button class="cancel-btn" onclick={(e) => handleCancel(j.id, e)} title="Cancel">×</button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  <button class="clear-btn" onclick={onClearJobs} title="Clear completed jobs">clear</button>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #111;
    border: 1px solid #1e1e1e;
    border-radius: 6px;
    margin-bottom: 1rem;
    overflow-x: auto;
  }
  .strip-jobs {
    display: flex;
    gap: 0.35rem;
    flex: 1;
    flex-wrap: wrap;
    min-width: 0;
  }
  .strip-empty {
    font-size: 0.72rem;
    color: #666;
    font-family: monospace;
  }
  .strip-job-wrap {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .strip-job {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.55rem;
    background: #0d0d0d;
    border: 1px solid #1e1e1e;
    border-radius: 4px;
    font-size: 0.72rem;
    transition: border-color 0.15s;
    min-width: 0;
  }
  .strip-job:hover { border-color: #2e2e2e; }
  .strip-job.selected { border-color: #00bcd4; }
  .strip-label {
    color: #aaa;
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strip-age {
    color: #555;
    font-size: 0.65rem;
    font-family: monospace;
    white-space: nowrap;
  }
  .cancel-btn {
    all: unset;
    color: #666;
    font-size: 0.9rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 0.1rem;
  }
  .cancel-btn:hover { color: #f44336; }
  .clear-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.65rem;
    color: #777;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 3px;
    padding: 0.15rem 0.5rem;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.15s, border-color 0.15s;
  }
  .clear-btn:hover { color: #ef5350; border-color: #4a1a1a; }
</style>
