<script lang="ts">
  import { jobsStore } from '../stores/jobs.svelte';
  import { dashStore } from '../stores/dashboard.svelte';
  import StatsBar from './StatsBar.svelte';
  import DashPanel from './DashPanel.svelte';
  import RawLog from './RawLog.svelte';
  import { shortUrl, fmtK, timeAgo, getJobLabel } from '../lib/format';
  import { cancelJob } from '../lib/api';

  const s = $derived(dashStore.state);
  const activeScrapesList = $derived([...s.activeScrapes.values()]);
  const recentJobs = $derived(jobsStore.jobs.slice(0, 8));

  // Auto-connect to the latest running job when no job is loaded
  $effect(() => {
    const running = jobsStore.jobs.find(j => j.status === 'running');
    if (running && !dashStore.state.job) {
      dashStore.openJob(running.id);
    }
  });

  async function handleClearJobs() {
    await jobsStore.clear();
    dashStore.reset();
  }

  async function handleCancel(id: string, e: MouseEvent) {
    e.stopPropagation();
    await cancelJob(id);
    await jobsStore.refresh();
  }


</script>

<div class="monitor-scroll">

<!-- Job selector bar -->
<div class="job-selector">
  <span class="job-selector-label">Job</span>
  {#if jobsStore.jobs.length === 0}
    <span class="job-selector-empty">No jobs yet</span>
  {:else}
    <div class="job-chips">
      {#each recentJobs as j (j.id)}
        <div class="job-chip-wrap">
          <button
            class="job-chip"
            class:selected={j.id === jobsStore.selectedJobId}
            class:running={j.status === 'running'}
            onclick={() => dashStore.openJob(j.id)}
            title={getJobLabel(j)}
          >
            <span class="job-chip-dot" class:running={j.status === 'running'} class:done={j.status === 'done'} class:failed={j.status === 'failed'}></span>
            <span class="job-chip-label">{getJobLabel(j)}</span>
            <span class="job-chip-age">{timeAgo(j.startedAt)}</span>
          </button>
          {#if j.status === 'running'}
            <button class="job-chip-cancel" onclick={(e) => handleCancel(j.id, e)} title="Cancel">×</button>
          {/if}
        </div>
      {/each}
      {#if jobsStore.jobs.length > 8}
        <span class="job-chip-more">+{jobsStore.jobs.length - 8}</span>
      {/if}
    </div>
    <button class="job-clear-btn" onclick={handleClearJobs}>clear</button>
  {/if}
</div>

<StatsBar />

<div class="action-ticker" class:idle={dashStore.state.job?.status !== 'running'}>
  <span class="ticker-dot" class:active={dashStore.state.job?.status === 'running'}></span>
  <span class="ticker-text">{dashStore.currentAction}<span class="ticker-cursor" class:active={dashStore.state.job?.status === 'running'}>▋</span></span>
</div>

<div class="monitor-grid">
  <!-- Active Scrapes -->
  <DashPanel title="Active Scrapes" count={s.activeScrapes.size} color="#f59e0b">
    <div class="p-header">
      <span class="p-indicator">●</span>
      <span class="p-main">URL / Provider</span>
      <span class="p-meta">Depth · Time</span>
    </div>
    {#if activeScrapesList.length === 0}
      <div class="empty">No active scrapes</div>
    {:else}
      {#each activeScrapesList as sc (sc.url)}
        <div class="p-row active-row">
          <span class="p-indicator active">●</span>
          <span class="p-main" title={sc.url}>{shortUrl(sc.url)}</span>
          <span class="p-meta">{sc.depth != null ? `depth ${sc.depth} · ` : ''}{sc.ts}</span>
        </div>
      {/each}
    {/if}
  </DashPanel>

  <!-- Search Queries -->
  <DashPanel title="Search Queries" count={s.searches.length} color="#60a5fa">
    <div class="p-header">
      <span class="p-indicator">⌕</span>
      <span class="p-main">Query</span>
      <span class="p-meta">Results</span>
    </div>
    {#if s.searches.length === 0}
      <div class="empty">No searches yet</div>
    {:else}
      {#each [...s.searches].reverse() as sq}
        <div class="p-row">
          <span class="p-indicator search">⌕</span>
          <span class="p-main" title={sq.query}>{sq.query}</span>
          <span class="p-meta">{sq.count != null ? sq.count : '…'}</span>
        </div>
      {/each}
    {/if}
  </DashPanel>

  <!-- Updated Rows -->
  <DashPanel title="Updated Rows" count={s.updateRows.length} color="#34d399">
    <div class="p-header">
      <span class="p-indicator">✓</span>
      <span class="p-main">Provider</span>
      <span class="p-meta">Changed · Time</span>
    </div>
    {#if s.updateRows.length === 0}
      <div class="empty">No rows updated yet</div>
    {:else}
      {#each s.updateRows as r}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="p-row"
          class:update-row-link={!!r.dataset}
          onclick={() => { if (r.dataset) dashStore.navTarget = r.dataset; }}
          title={r.dataset ? `Open dataset: ${r.dataset}` : r.provider}
        >
          <span class="p-indicator {r.changed ? 'extract' : 'done'}">✓</span>
          <span class="p-main">{r.provider}</span>
          <span class="p-meta" style={r.changed ? 'color:#16a34a' : ''}>{r.changed ? 'CHANGED' : 'same'} · {r.ts}</span>
          {#if r.dataset}<span class="update-row-ds">→</span>{/if}
        </div>
      {/each}
    {/if}
  </DashPanel>

  <!-- Completed Scrapes -->
  <DashPanel title="Completed Scrapes" count={s.completedScrapes.length} color="#a78bfa">
    <div class="p-header">
      <span class="p-indicator">✓</span>
      <span class="p-main">URL</span>
      <span class="p-meta">Chars · Links</span>
    </div>
    {#if s.completedScrapes.length === 0}
      <div class="empty">No completed scrapes</div>
    {:else}
      {#each s.completedScrapes.slice(0, 80) as sc}
        <div class="p-row">
          <span class="p-indicator done">✓</span>
          <span class="p-main" title={sc.url}>{shortUrl(sc.url)}</span>
          <span class="p-meta">{sc.chars ? fmtK(sc.chars) : ''}{sc.chars && sc.links ? ' · ' : ''}{sc.links ?? ''}</span>
        </div>
      {/each}
    {/if}
  </DashPanel>

  <!-- Extractions -->
  <DashPanel title="Extractions" count={s.extractions.length} color="#34d399">
    <div class="p-header">
      <span class="p-indicator">+</span>
      <span class="p-main">URL</span>
      <span class="p-meta">Found · Total</span>
    </div>
    {#if s.extractions.length === 0}
      <div class="empty">No extractions yet</div>
    {:else}
      {#each [...s.extractions].reverse().slice(0, 60) as ex}
        <div class="p-row">
          <span class="p-indicator extract">+{ex.count}</span>
          <span class="p-main" title={ex.url}>{shortUrl(ex.url)}</span>
          <span class="p-meta">{ex.count} · {ex.total}</span>
        </div>
      {/each}
    {/if}
  </DashPanel>


</div>

<!-- Errors (full width) -->
<div style="margin-top:0.75rem">
  <DashPanel title="Errors" count={s.errors.length} color="#f87171">
    <div class="p-header">
      <span class="p-indicator">✗</span>
      <span class="p-main">Tool · Message</span>
      <span class="p-meta">Time</span>
    </div>
    {#if s.errors.length === 0}
      <div class="empty">No errors</div>
    {:else}
      {#each [...s.errors].reverse() as err}
        <div class="p-row" style="flex-direction:column;align-items:flex-start;gap:0.1rem;padding:0.3rem 0">
          <span style="color:#dc2626;font-size:0.7rem;word-break:break-all;overflow-wrap:anywhere">
            {err.tool ? `[${err.tool}] ` : ''}{err.message}
          </span>
          <span style="color:var(--on-surface-muted);font-size:0.62rem">{err.ts}</span>
        </div>
      {/each}
    {/if}
  </DashPanel>
</div>

<!-- Raw Log (full width, collapsible) -->
<div style="margin-top:0.75rem">
  <RawLog entries={s.rawLog} />
</div>

</div> <!-- /monitor-scroll -->

<style>
  .action-ticker {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.5rem 0.85rem;
    margin-bottom: 0.75rem;
    background: var(--surface-container-low);
    border: 1px solid rgba(22, 163, 74, 0.3);
    border-radius: 4px;
    font-family: "IBM Plex Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    color: #16a34a;
    min-width: 0;
    transition: color 0.3s, border-color 0.3s, background 0.3s;
  }
  .action-ticker.idle {
    color: var(--on-surface-muted);
    border-color: var(--c-border-light);
    background: var(--surface-container-lowest);
  }
  .ticker-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #d0cec8;
    flex-shrink: 0;
    margin-top: 0.35rem;
  }
  .ticker-dot.active {
    background: #16a34a;
    animation: ticker-pulse 1.4s ease-in-out infinite;
  }
  @keyframes ticker-pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 4px #16a34a; }
    50% { opacity: 0.4; box-shadow: none; }
  }
  .ticker-text {
    white-space: pre-wrap;
    word-break: break-word;
    min-height: 4.2em;
    line-height: 1.6;
  }
  .ticker-cursor {
    opacity: 0;
    font-size: 0.8em;
    vertical-align: baseline;
    margin-left: 1px;
  }
  .ticker-cursor.active {
    opacity: 1;
    animation: cursor-blink 1s step-end infinite;
  }
  @keyframes cursor-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* Job selector bar */
  .job-selector {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--surface-container-low);
    border: 1px solid var(--c-border-light);
    border-radius: 4px;
    min-width: 0;
  }
  .job-selector-label {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--on-surface-muted);
    flex-shrink: 0;
  }
  .job-selector-empty {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.72rem;
    color: var(--on-surface-muted);
  }
  .job-chips {
    display: flex;
    gap: 0.35rem;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    align-items: center;
  }
  .job-chips::-webkit-scrollbar { display: none; }

  .job-chip-wrap {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .job-chip {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.22rem 0.5rem;
    border-radius: 3px;
    border: 1px solid var(--c-border-light);
    background: var(--surface-container);
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color 0.15s, background 0.15s;
    font-family: "IBM Plex Mono", monospace;
  }
  .job-chip:hover { border-color: var(--c-border); background: var(--surface-container-high); }
  .job-chip.selected {
    border-color: #22d3ee;
    background: var(--surface-container-highest);
  }
  .job-chip.selected.running {
    border-color: #16a34a;
    background: var(--surface-container-highest);
  }

  .job-chip-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #d0cec8;
    flex-shrink: 0;
  }
  .job-chip-dot.running { background: #16a34a; animation: ticker-pulse 1.4s ease-in-out infinite; }
  .job-chip-dot.done    { background: #22d3ee; }
  .job-chip-dot.failed  { background: #dc2626; }

  .job-chip-label {
    font-size: 0.75rem;
    color: var(--on-surface-muted);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }
  .job-chip.selected .job-chip-label { color: var(--on-surface); }
  .job-chip:hover .job-chip-label { color: var(--on-surface); }

  .job-chip-age {
    font-size: 0.67rem;
    color: var(--on-surface-muted);
    flex-shrink: 0;
  }
  .job-chip.selected .job-chip-age { color: var(--on-surface-muted); }

  .job-chip-cancel {
    all: unset;
    cursor: pointer;
    color: var(--on-surface-muted);
    font-size: 0.8rem;
    line-height: 1;
    flex-shrink: 0;
    padding: 0 0.1rem;
    transition: color 0.12s;
  }
  .job-chip-cancel:hover { color: #dc2626; }

  .job-chip-more {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.67rem;
    color: var(--on-surface-muted);
    flex-shrink: 0;
    padding: 0 0.2rem;
  }

  .job-clear-btn {
    all: unset;
    cursor: pointer;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.67rem;
    color: var(--on-surface-muted);
    flex-shrink: 0;
    transition: color 0.15s;
    margin-left: auto;
  }
  .job-clear-btn:hover { color: #dc2626; }

  .monitor-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
  }
  @media (max-width: 1100px) {
    .monitor-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 700px) {
    .monitor-grid { grid-template-columns: 1fr; }
  }

  .update-row-link {
    cursor: pointer;
  }
  .update-row-link:hover .p-main { color: #0e7490; }
  .update-row-ds {
    font-size: 0.65rem;
    color: #22d3ee;
    opacity: 0.5;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .update-row-link:hover .update-row-ds { opacity: 1; }
</style>
