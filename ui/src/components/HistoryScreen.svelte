<script lang="ts">
  import { jobsStore } from '../stores/jobs.svelte';
  import { dashStore } from '../stores/dashboard.svelte';
  import { cancelJob, startIndexJob, startUpdateJob } from '../lib/api';
  import { timeAgo, getJobLabel } from '../lib/format';

  const { onOpenExtraction }: { onOpenExtraction: (output: string) => void } = $props();

  type Filter = 'all' | 'running' | 'done' | 'failed';
  let filter = $state<Filter>('all');

  const jobs = $derived(jobsStore.jobs);

  const filtered = $derived(
    filter === 'all'
      ? jobs
      : filter === 'running'
        ? jobs.filter(j => j.status === 'running')
        : filter === 'done'
          ? jobs.filter(j => j.status === 'done')
          : jobs.filter(j => j.status === 'failed' || j.status === 'cancelled')
  );

  const runningCount = $derived(jobs.filter(j => j.status === 'running').length);
  const doneCount    = $derived(jobs.filter(j => j.status === 'done').length);
  const failedCount  = $derived(jobs.filter(j => j.status === 'failed').length);
  const successRate  = $derived(
    doneCount + failedCount > 0
      ? Math.round((doneCount / (doneCount + failedCount)) * 100)
      : 100
  );

  function handleViewDetails(job: typeof jobs[number]) {
    const output = job.params.output ?? job.params.input;
    if (output) {
      onOpenExtraction(output);
    }
  }

  async function handleCancel(id: string) {
    await cancelJob(id);
    await jobsStore.refresh();
  }

  async function handleReplay(job: typeof jobs[number]) {
    if (job.type === 'index' && job.params.topic && job.params.schema && job.params.output) {
      await startIndexJob({
        topic: job.params.topic,
        schema: job.params.schema,
        output: job.params.output,
        maxIterations: job.params.maxIterations,
      });
    } else if (job.type === 'update' && job.params.input && job.params.schema) {
      await startUpdateJob({ input: job.params.input, schema: job.params.schema });
    }
    await jobsStore.refresh();
  }

  async function handleClear() {
    await jobsStore.clear();
    dashStore.reset();
  }

  function cardColor(status: string) {
    if (status === 'running') return '#ff590a';
    if (status === 'done')    return '#ff590a';
    if (status === 'failed')  return '#ef4444';
    return '#3a3a3a';
  }

  function statusLabel(status: string) {
    if (status === 'running')   return 'ACTIVE';
    if (status === 'done')      return 'COMPLETE';
    if (status === 'failed')    return 'FAILED';
    if (status === 'cancelled') return 'CANCELLED';
    return status.toUpperCase();
  }

  function statusColor(status: string) {
    if (status === 'running')   return '#ff590a';
    if (status === 'done')      return '#22c55e';
    if (status === 'failed')    return '#ef4444';
    return '#6a6a6a';
  }

  function jobCategory(job: typeof jobs[number]) {
    return job.type === 'index' ? 'EXTRACTION' : 'UPDATE';
  }
</script>

<div class="history-root">
  <!-- Hero header -->
  <div class="hero">
    <div class="hero-text">
      <h1 class="hero-title">Extraction History</h1>
      <p class="hero-sub">All jobs run on this node</p>
    </div>
    <div class="hero-stats">
      <div class="stat-card">
        <span class="stat-value" style="color: #ff590a">{runningCount}</span>
        <span class="stat-label">Active Threads</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{successRate}%</span>
        <span class="stat-label">Success Rate</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{jobs.length}</span>
        <span class="stat-label">Total Jobs</span>
      </div>
    </div>
  </div>

  <!-- Filter bar -->
  <div class="filter-bar">
    <div class="filter-tabs">
      {#each (['all', 'running', 'done', 'failed'] as const) as f}
        <button
          class="filter-tab"
          class:active={filter === f}
          onclick={() => filter = f}
        >
          {f === 'all' ? 'All Runs' : f === 'running' ? 'Active' : f === 'done' ? 'Completed' : 'Failed'}
          {#if f === 'running' && runningCount > 0}
            <span class="filter-dot"></span>
          {/if}
        </button>
      {/each}
    </div>
    {#if jobs.length > 0}
      <button class="clear-btn" onclick={handleClear}>Clear History</button>
    {/if}
  </div>

  <!-- Main content -->
  <div class="main-area">
    <!-- Job list -->
    <div class="job-list">
      {#if filtered.length === 0}
        <div class="empty-state">
          <span class="msicon" style="font-size:2.5rem;color:var(--on-surface-muted)">history</span>
          <p>No jobs {filter !== 'all' ? `with status "${filter}"` : 'yet'}</p>
        </div>
      {:else}
        {#each filtered as job (job.id)}
          <div
            class="job-card"
            style="--accent: {cardColor(job.status)}"
          >
            <div class="card-accent-bar"></div>
            <div class="card-body">
              <div class="card-top">
                <div class="card-meta">
                  <span class="card-category">{jobCategory(job)}</span>
                  <span class="card-date">{timeAgo(job.startedAt)}</span>
                </div>
                <div class="card-status">
                  <span class="status-dot" style="background: {statusColor(job.status)}"
                    class:pulse={job.status === 'running'}></span>
                  <span class="status-label" style="color: {statusColor(job.status)}">{statusLabel(job.status)}</span>
                </div>
              </div>

              <h3 class="card-title">{getJobLabel(job)}</h3>

              {#if job.params.output || job.params.input}
                <div class="card-dataset">
                  <span class="msicon" style="font-size:12px;vertical-align:middle">database</span>
                  {job.params.output ?? job.params.input}
                </div>
              {/if}

              <div class="card-actions">
                {#if job.params.output || job.params.input}
                  <button
                    class="card-btn primary"
                    onclick={() => handleViewDetails(job)}
                  >
                    <span class="msicon" style="font-size:14px">monitoring</span>
                    View Details
                  </button>
                {/if}
                {#if job.status !== 'running'}
                  <button class="card-btn" onclick={() => handleReplay(job)}>
                    <span class="msicon" style="font-size:14px">replay</span>
                    Replay
                  </button>
                {/if}
                {#if job.status === 'running'}
                  <button class="card-btn danger" onclick={() => handleCancel(job.id)}>
                    <span class="msicon" style="font-size:14px">stop</span>
                    Cancel
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

  </div>

  <!-- Watermark -->
  <div class="watermark">HIST</div>
</div>

<style>
  .history-root {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2.5rem 2.5rem 4rem;
    position: relative;
  }

  .hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 2rem;
    margin-bottom: 2rem;
  }
  .hero-title {
    font-family: 'Inter', sans-serif;
    font-size: 2rem;
    font-weight: 800;
    color: var(--on-surface);
    margin: 0 0 0.3rem;
    letter-spacing: -0.03em;
  }
  .hero-sub {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
    color: var(--on-surface-muted);
    margin: 0;
    letter-spacing: 0.04em;
  }
  .hero-stats {
    display: flex;
    gap: 1.5rem;
    flex-shrink: 0;
  }
  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
    background: var(--surface-container-low);
    padding: 0.85rem 1.25rem;
    min-width: 100px;
  }
  .stat-value {
    font-family: 'Inter', sans-serif;
    font-size: 1.6rem;
    font-weight: 800;
    color: var(--on-surface);
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .stat-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }

  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    gap: 1rem;
  }
  .filter-tabs {
    display: flex;
    gap: 2px;
    background: var(--surface-container-low);
    padding: 3px;
  }
  .filter-tab {
    all: unset;
    cursor: pointer;
    padding: 0.45rem 1rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    transition: color 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .filter-tab:hover { color: var(--on-surface); }
  .filter-tab.active {
    background: var(--surface-container-highest);
    color: var(--on-surface);
  }
  .filter-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #ff590a;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .clear-btn {
    all: unset;
    cursor: pointer;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    transition: color 0.15s;
  }
  .clear-btn:hover { color: #ef4444; }

  .main-area {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .job-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 4rem 2rem;
    color: var(--on-surface-muted);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
  }

  .job-card {
    display: flex;
    background: var(--surface-container-low);
    transition: background 0.15s;
    cursor: default;
    position: relative;
    overflow: hidden;
  }
  .job-card:hover { background: var(--surface-container); }
  .job-card.selected { background: var(--surface-container); }

  .card-accent-bar {
    width: 3px;
    flex-shrink: 0;
    background: var(--accent);
    align-self: stretch;
  }

  .card-body {
    flex: 1;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .card-category {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    background: var(--surface-container-high);
    padding: 0.15rem 0.5rem;
  }
  .card-date {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    color: var(--on-surface-muted);
  }
  .card-status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.pulse {
    animation: pulse 1.4s ease-in-out infinite;
  }
  .status-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .card-title {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--on-surface);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-dataset {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    color: var(--on-surface-muted);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .card-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.85rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    background: var(--surface-container-high);
    transition: color 0.15s, background 0.15s;
  }
  .card-btn:hover { color: var(--on-surface); background: var(--surface-container-highest); }
  .card-btn.primary { color: var(--on-surface); }
  .card-btn.primary:hover { color: #ff590a; }
  .card-btn.danger:hover { color: #ef4444; }

  /* Watermark */
  .watermark {
    position: fixed;
    bottom: 2rem;
    right: 2.5rem;
    font-family: 'Inter', sans-serif;
    font-size: 6rem;
    font-weight: 900;
    color: var(--on-surface);
    opacity: 0.025;
    letter-spacing: -0.05em;
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
</style>
