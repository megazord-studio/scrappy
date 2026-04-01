<script lang="ts">
  import { getRecords, cancelJob, startIndexJob, startUpdateJob, getDatasetSchema, getQaIssues, dedupeOutput } from '../lib/api';
  import { dashStore } from '../stores/dashboard.svelte';
  import { jobsStore } from '../stores/jobs.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import QaPanel from './QaPanel.svelte';

  const {
    output,
    jobId = null,
  }: {
    output: string;
    jobId?: string | null;
  } = $props();

  let chatVisible = $state(localStorage.getItem('scrappy-chat') !== 'hidden');
  let qaVisible   = $state(false);
  let qaCount     = $state(0);

  let headers   = $state<string[]>([]);
  let rows      = $state<Record<string, string>[]>([]);
  let loading   = $state(true);
  let newCount  = $state(0);         // how many tail rows are "new"
  let prevLen   = $state(0);
  let newTimer: ReturnType<typeof setTimeout> | null = null;

  const job = $derived(
    jobId
      ? jobsStore.jobs.find(j => j.id === jobId) ?? null
      : jobsStore.jobs.find(j =>
          (j.params.output === output || j.params.input === output) && j.status === 'running'
        ) ?? null
  );

  // Most recent job for this output (any status) — used to replay params
  const latestJob = $derived(
    jobsStore.jobs.find(j => j.params.output === output || j.params.input === output)
  );

  let runningAction = $state<string | null>(null);
  let dedupeResult = $state<{ removed: number } | null>(null);

  async function handleDedupe() {
    runningAction = 'dedupe';
    try {
      const res = await dedupeOutput(output) as { removed: number };
      dedupeResult = res;
      await loadRecords();
      setTimeout(() => { dedupeResult = null; }, 4000);
    } finally { runningAction = null; }
  }

  async function getSchema(): Promise<string | null> {
    return latestJob?.params.schema ?? await getDatasetSchema(output);
  }

  async function handleReindex() {
    if (!latestJob?.params.topic || !latestJob?.params.schema) return;
    runningAction = 'reindex';
    try {
      await startIndexJob({
        topic: latestJob.params.topic,
        schema: latestJob.params.schema,
        output,
        maxIterations: latestJob.params.maxIterations,
      });
      await jobsStore.refresh();
    } finally { runningAction = null; }
  }

  async function handleUpdateAll() {
    const schema = await getSchema();
    if (!schema) return;
    runningAction = 'update';
    try {
      await startUpdateJob({ input: output, schema });
      await jobsStore.refresh();
    } finally { runningAction = null; }
  }

  async function handleCancel() {
    if (!job?.id) return;
    runningAction = 'cancel';
    try {
      await cancelJob(job.id);
      await jobsStore.refresh();
    } finally { runningAction = null; }
  }

  async function handleUpdateRow(recordId: number) {
    const schema = await getSchema();
    if (!schema) return;
    runningAction = `row-${recordId}`;
    try {
      await startUpdateJob({ input: output, schema, recordId });
      await jobsStore.refresh();
    } finally { runningAction = null; }
  }
  const isRunning      = $derived(job?.status === 'running');
  const activeScrapes  = $derived([...dashStore.state.activeScrapes.values()]);
  const recordCount    = $derived(dashStore.state.recordCount || rows.length);
  const iteration      = $derived(dashStore.state.iteration);
  const maxIterations  = $derived(dashStore.state.maxIterations);

  // Columns: skip URL-looking fields, keep at most 5 data columns
  const urlCol = $derived(headers.find(h => /(^url$|^uri$|link|href)/i.test(h)) ?? null);
  const displayCols = $derived(
    headers
      .filter(h => !/(^url$|^uri$|link|href)/i.test(h))
  );
  const primaryCol = $derived(displayCols[0] ?? headers[0] ?? '');

  function rowStatus(i: number): 'indexing' | 'complete' {
    if (isRunning && i >= rows.length - newCount) return 'indexing';
    return 'complete';
  }

  async function loadRecords() {
    try {
      const res = await getRecords(output);
      const diff = res.rows.length - prevLen;
      headers = res.headers;
      rows    = res.rows;
      loading = false;
      if (diff > 0) {
        prevLen  = res.rows.length;
        newCount = diff;
        if (newTimer) clearTimeout(newTimer);
        newTimer = setTimeout(() => { newCount = 0; }, 4000);
      } else {
        prevLen = res.rows.length;
      }
    } catch { loading = false; }
  }

  async function loadQaCount() {
    try {
      const res = await getQaIssues(output);
      qaCount = res.issues.length;
    } catch { /* ignore */ }
  }

  $effect(() => {
    if (jobId) dashStore.openJob(jobId);
    loadRecords();
    loadQaCount();
    const iv = setInterval(loadRecords, isRunning ? 2000 : 8000);
    return () => { clearInterval(iv); if (newTimer) clearTimeout(newTimer); };
  });

  // re-set interval rate when running state changes
  $effect(() => { void isRunning; });

  function initial(row: Record<string, string>): string {
    const val = row[primaryCol] ?? '';
    return val.charAt(0).toUpperCase() || '?';
  }
</script>

<div class="detail-root">
  <!-- Main column -->
  <div class="main-col">

    <!-- Header -->
    <div class="detail-header">
      <div class="header-left">
        <span class="eyebrow">Real-time Stream</span>
        <h1 class="page-title">{output}</h1>
      </div>
      <div class="header-right">
        {#if isRunning}
          <div class="live-badge">
            <span class="live-dot"></span>
            <span class="live-label">Live Indexing</span>
          </div>
          {#if maxIterations > 0}
            <div class="progress-badge">
              <span class="progress-label">Iteration {iteration} / {maxIterations}</span>
              <div class="progress-track">
                <div class="progress-fill" style="width: {Math.round((iteration / maxIterations) * 100)}%"></div>
              </div>
            </div>
          {/if}
        {:else if job}
          <div class="done-badge">
            <span class="msicon" style="font-size:14px">check_circle</span>
            <span>{job.status}</span>
          </div>
        {/if}

        <div class="header-actions">
          {#if isRunning}
            <button
              class="hdr-btn hdr-btn--danger"
              onclick={handleCancel}
              disabled={runningAction === 'cancel'}
              title="Cancel job"
            >
              <span class="msicon" style="font-size:15px">stop</span>
              Cancel
            </button>
          {:else}
            {#if latestJob?.type === 'index' && latestJob.params.topic}
              <button
                class="hdr-btn"
                onclick={handleReindex}
                disabled={runningAction !== null}
                title="Re-run discovery with same settings"
              >
                <span class="msicon" style="font-size:15px">search_insights</span>
                Re-index
              </button>
            {/if}
            <button
              class="hdr-btn hdr-btn--primary"
              onclick={handleUpdateAll}
              disabled={runningAction !== null || rows.length === 0}
              title="Re-scrape all records"
            >
              <span class="msicon" style="font-size:15px">sync</span>
              Update All
            </button>
            <button
              class="hdr-btn"
              onclick={handleDedupe}
              disabled={runningAction !== null || rows.length === 0}
              title="Remove duplicate records"
            >
              <span class="msicon" style="font-size:15px" class:spinning={runningAction === 'dedupe'}>
                {runningAction === 'dedupe' ? 'hourglass_empty' : 'deblur'}
              </span>
              {#if dedupeResult !== null}
                {dedupeResult.removed} removed
              {:else}
                Dedupe
              {/if}
            </button>
          {/if}
        </div>

        <button
          class="hdr-btn"
          class:qa-active={qaVisible}
          onclick={() => { qaVisible = !qaVisible; }}
          title={qaVisible ? 'Hide QA panel' : 'Show QA review'}
        >
          <span class="msicon" style="font-size:15px">verified</span>
          QA
          {#if qaCount > 0}
            <span class="qa-badge">{qaCount}</span>
          {/if}
        </button>

        <button
          class="chat-toggle"
          onclick={() => { chatVisible = !chatVisible; localStorage.setItem('scrappy-chat', chatVisible ? 'visible' : 'hidden'); }}
          title={chatVisible ? 'Hide assistant' : 'Show assistant'}
        >
          <span class="msicon" style="font-size:18px">smart_toy</span>
        </button>
      </div>
    </div>

    <!-- QA Panel (replaces table when active) -->
    {#if qaVisible}
      <div class="table-wrap">
        <QaPanel
          {output}
          {rows}
          onClose={() => { qaVisible = false; }}
          onRecordsChanged={() => { void loadRecords(); void loadQaCount(); }}
        />
      </div>
    {/if}

    <!-- Table -->
    <div class="table-wrap" class:hidden={qaVisible}>
      {#if loading}
        <div class="table-empty">Loading records…</div>
      {:else if rows.length === 0 && activeScrapes.length === 0}
        <div class="table-empty">No records yet</div>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-provider">Provider</th>
              {#each displayCols.slice(1) as col}
                <th>{col}</th>
              {/each}
              <th class="col-status">Status</th>
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            <!-- Shimmer rows for active scrapes (indexing in progress) -->
            {#if isRunning}
              {#each activeScrapes.slice(0, 2) as sc}
                <tr class="shimmer-row">
                  <td>
                    <div class="cell-provider">
                      <div class="avatar shimmer-avatar">?</div>
                      <span class="shimmer-url">{sc.url.replace(/^https?:\/\//, '').slice(0, 30)}</span>
                    </div>
                  </td>
                  {#each displayCols.slice(1) as _}
                    <td><div class="shimmer-bar"></div></td>
                  {/each}
                  <td>
                    <span class="status-badge indexing">
                      <span class="status-dot"></span>Indexing
                    </span>
                  </td>
                  <td></td>
                </tr>
              {/each}
            {/if}

            <!-- Actual records (newest at top) -->
            {#each [...rows].reverse() as row, i (i)}
              {@const status = rowStatus(rows.length - 1 - i)}
              {@const rowId = parseInt(row._id)}
              <tr class="data-row" class:new-row={status === 'indexing'}>
                <td>
                  <div class="cell-provider">
                    <div class="avatar">{initial(row)}</div>
                    <span class="provider-name">{row[primaryCol] ?? '—'}</span>
                  </div>
                </td>
                {#each displayCols.slice(1) as col}
                  <td class="data-cell">{row[col] ?? '—'}</td>
                {/each}
                <td>
                  {#if status === 'indexing'}
                    <span class="status-badge indexing">
                      <span class="status-dot"></span>Indexing
                    </span>
                  {:else}
                    <span class="status-badge complete">Complete</span>
                  {/if}
                </td>
                <td>
                  <div class="row-actions">
                    {#if urlCol && row[urlCol]}
                      <a
                        class="row-action"
                        href={row[urlCol]}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={row[urlCol]}
                      >
                        <span class="msicon">open_in_new</span>
                      </a>
                    {/if}
                    <button
                      class="row-action"
                      onclick={() => handleUpdateRow(rowId)}
                      disabled={runningAction !== null || isRunning}
                      title="Update this record"
                    >
                      <span class="msicon" class:spinning={runningAction === `row-${rowId}`}>
                        {runningAction === `row-${rowId}` ? 'hourglass_empty' : 'refresh'}
                      </span>
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Footer stats -->
    <div class="footer-stats">
      <div class="stat-box">
        <span class="stat-name">Records Indexed</span>
        <span class="stat-val">{rows.length}</span>
      </div>
      <div class="stat-box">
        <span class="stat-name">Active Scrapes</span>
        <span class="stat-val" style={activeScrapes.length > 0 ? 'color:#ff590a' : ''}>{activeScrapes.length}</span>
      </div>
      <div class="stat-box">
        <span class="stat-name">Current Action</span>
        <span class="stat-val stat-action">{dashStore.currentAction}</span>
      </div>
    </div>
  </div>

  <!-- Chat sidebar -->
  <aside class="chat-sidebar" class:hidden={!chatVisible}>
    <div class="chat-header">
      <span class="msicon" style="font-size:18px;color:#ff590a">smart_toy</span>
      <span class="chat-title">Extraction Assistant</span>
    </div>
    <div class="chat-body">
      <ChatPanel jobId={job?.id} {output} />
    </div>
  </aside>
</div>

<style>
  .detail-root {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Main column */
  .main-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Header */
  .detail-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 2rem 2rem 1.25rem;
    flex-shrink: 0;
    gap: 1rem;
  }
  .eyebrow {
    display: block;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--primary-container);
    margin-bottom: 0.4rem;
  }
  .page-title {
    font-family: 'Inter', sans-serif;
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--on-surface);
    letter-spacing: -0.03em;
    margin: 0;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }
  .live-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface-container-low);
    border: 1px solid rgba(255,255,255,0.05);
    padding: 0.35rem 0.75rem;
  }
  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ff590a;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .live-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .progress-badge {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 140px;
  }
  .progress-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    color: var(--on-surface-muted);
  }
  .progress-track {
    height: 2px;
    background: rgba(255,255,255,0.06);
    width: 100%;
  }
  .progress-fill {
    height: 100%;
    background: #ff590a;
    transition: width 0.5s ease;
  }
  .done-badge {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #22c55e;
  }

  /* Table */
  .table-wrap {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    border-top: 1px solid rgba(255,255,255,0.03);
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .table-empty {
    padding: 3rem 2rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
    color: var(--on-surface-muted);
    text-align: center;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'Space Grotesk', sans-serif;
  }
  .data-table thead tr {
    background: var(--surface-container-low);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .data-table th {
    padding: 0.85rem 1.25rem;
    font-size: 0.58rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
  }
  .col-status { width: 110px; }
  .col-actions { width: 48px; }
  .col-provider { min-width: 180px; }

  .data-row, .shimmer-row {
    border-bottom: 1px solid rgba(255,255,255,0.02);
    transition: background 0.15s;
  }
  .data-row:hover { background: rgba(255,255,255,0.02); }
  .data-row:hover .row-actions { opacity: 1; }
  .new-row { animation: fadeIn 0.4s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

  .data-table td {
    padding: 1rem 1.25rem;
    vertical-align: middle;
  }

  .cell-provider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .avatar {
    width: 30px;
    height: 30px;
    background: var(--surface-container-highest);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter', sans-serif;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--on-surface);
    flex-shrink: 0;
  }
  .shimmer-avatar {
    background: var(--surface-container-high);
    color: var(--on-surface-muted);
    animation: shimmer 1.8s ease-in-out infinite;
  }
  .provider-name {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--on-surface);
  }
  .shimmer-url {
    font-size: 0.72rem;
    color: var(--on-surface-muted);
    font-family: monospace;
  }

  .data-cell {
    font-size: 0.78rem;
    color: var(--on-surface-muted);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shimmer-bar {
    height: 8px;
    width: 80px;
    background: var(--surface-container-high);
    position: relative;
    overflow: hidden;
  }
  .shimmer-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,89,10,0.15) 50%, transparent 100%);
    animation: shimmerSlide 1.8s ease-in-out infinite;
  }
  @keyframes shimmerSlide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.9; }
  }

  /* Status badges */
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .status-badge.indexing {
    background: rgba(255,89,10,0.1);
    color: #ff590a;
    border: 1px solid rgba(255,89,10,0.2);
  }
  .status-badge.complete {
    background: rgba(34,197,94,0.08);
    color: #22c55e;
    border: 1px solid rgba(34,197,94,0.15);
  }
  .status-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }

  /* Row actions */
  .row-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .row-action {
    all: unset;
    cursor: pointer;
    color: var(--on-surface-muted);
    display: flex;
    align-items: center;
    padding: 0.25rem;
    transition: color 0.15s;
    font-size: 16px;
  }
  .row-action:hover { color: var(--on-surface); }

  /* Footer stats */
  .footer-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid rgba(255,255,255,0.03);
    flex-shrink: 0;
  }
  .stat-box {
    padding: 0.85rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-right: 1px solid rgba(255,255,255,0.03);
  }
  .stat-box:last-child { border-right: none; }
  .stat-name {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .stat-val {
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--on-surface);
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .stat-action {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    font-weight: 400;
    color: var(--on-surface-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .hdr-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.85rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    border-radius: 2px;
    transition: color 0.15s, background 0.15s, border-color 0.15s;
  }
  .hdr-btn:hover:not(:disabled) { color: var(--on-surface); background: var(--surface-container-high); }
  .hdr-btn--primary { color: var(--on-surface); }
  .hdr-btn--primary:hover:not(:disabled) { color: #ff590a; border-color: rgba(255,89,10,0.3); }
  .hdr-btn--danger:hover:not(:disabled) { color: #ef4444; border-color: rgba(239,68,68,0.3); }
  .hdr-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .chat-toggle {
    all: unset;
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--on-surface-muted);
    border-radius: 2px;
    transition: color 0.15s, background 0.15s;
  }
  .chat-toggle:hover { color: var(--primary-container); background: var(--surface-container); }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinning { animation: spin 1s linear infinite; }

  /* Chat sidebar */
  .chat-sidebar {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface-container-low);
    border-left: 1px solid rgba(255,255,255,0.04);
    overflow: hidden;
  }
  .chat-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    flex-shrink: 0;
    background: var(--surface-container);
  }
  .chat-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--on-surface);
  }
  .chat-sidebar.hidden { display: none; }
  .table-wrap.hidden { display: none; }

  .hdr-btn.qa-active {
    color: #ff590a;
    border-color: rgba(255,89,10,0.3);
    background: rgba(255,89,10,0.06);
  }
  .qa-badge {
    background: #ff590a;
    color: #fff;
    font-size: 0.55rem;
    font-weight: 700;
    padding: 0.05rem 0.35rem;
    border-radius: 20px;
    line-height: 1.4;
    min-width: 14px;
    text-align: center;
  }

  .chat-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
