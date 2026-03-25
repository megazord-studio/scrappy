<script lang="ts">
  import { getOutputs, deleteOutput, deleteSchema, getDatasetSchema } from '../lib/api';
  import { jobsStore } from '../stores/jobs.svelte';
  import RecordsTab from './RecordsTab.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import DatasetsSidebar from './DatasetsSidebar.svelte';
  import DatasetCreatePanel from './DatasetCreatePanel.svelte';
  import DatasetUpdatePanel from './DatasetUpdatePanel.svelte';

  const {
    outputs: initialOutputs,
    schemas,
    onSchemaEdit,
    onNewSchema,
    onSelectsReload,
  }: {
    outputs: string[];
    schemas: Array<{ id: string; display_name: string }>;
    onSchemaEdit: (id: string) => void;
    onNewSchema: () => void;
    onSelectsReload: () => void;
  } = $props();

  let datasets = $state<string[]>([]);
  let selectedDataset = $state<string | null>(null);
  let recordsTick = $state(0);

  $effect(() => {
    datasets = initialOutputs;
    if (selectedDataset === null && initialOutputs.length > 0) {
      selectedDataset = initialOutputs[0];
    }
  });

  let activePanel = $state<'update' | 'create' | null>(null);
  // schemaId for RecordsTab — auto-selected based on the dataset's creation schema
  let schemaId = $state('');

  // Auto-select the schema that was used to create the selected dataset
  $effect(() => {
    const ds = selectedDataset;
    if (!ds) return;
    getDatasetSchema(ds).then(id => {
      schemaId = id ?? schemas[0]?.id ?? '';
    });
  });

  const activeJob = $derived(
    jobsStore.jobs.find(j =>
      j.status === 'running' &&
      (j.params.output === selectedDataset || j.params.input === selectedDataset)
    ) ?? null
  );

  async function refreshDatasets() {
    const { outputs } = await getOutputs();
    datasets = outputs;
    onSelectsReload();
  }

  function handleSelectDataset(name: string) {
    selectedDataset = name;
    recordsTick++;
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete dataset "${name}"?`)) return;
    await deleteOutput(name);
    if (selectedDataset === name) { selectedDataset = null; activePanel = null; }
    await refreshDatasets();
  }

  async function handleDeleteSchema(id: string) {
    if (!confirm(`Delete schema "${id}"? This cannot be undone.`)) return;
    try {
      await deleteSchema(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return;
    }
    onSelectsReload();
  }

  async function handleCreateSubmit(params: { output: string }) {
    activePanel = null;
    await refreshDatasets();
    selectedDataset = params.output;
  }

  function handleUpdateSubmit() {
    activePanel = null;
  }
</script>

<div class="ds-root">
  <div class="ds-layout">

    <!-- Sidebar -->
    <DatasetsSidebar
      {datasets}
      {schemas}
      {selectedDataset}
      {activePanel}
      onSelectDataset={handleSelectDataset}
      onDelete={handleDelete}
      onNewDataset={() => { selectedDataset = null; activePanel = activePanel === 'create' ? null : 'create'; }}
      {onSchemaEdit}
      onDeleteSchema={handleDeleteSchema}
      {onNewSchema}
      onRefresh={refreshDatasets}
    />

    <!-- Main -->
    <div class="ds-main">
      {#if activePanel === 'create'}
        <!-- New Dataset form -->
        <DatasetCreatePanel
          {schemas}
          {datasets}
          onSubmit={handleCreateSubmit}
        />
      {:else if !selectedDataset}
        <div class="ds-empty">Select a dataset or create a new one</div>
      {:else}
        <!-- Top bar -->
        <div class="ds-topbar">
          <div class="ds-topbar-left">
            <div class="ds-topbar-name">{selectedDataset}</div>
          </div>
          <div class="ds-topbar-actions">
            <button class="ds-btn ds-btn--update" class:ds-btn--active={activePanel === 'update'} onclick={() => { activePanel = activePanel === 'update' ? null : 'update'; }}>↻ Update</button>
            <a class="ds-btn" href="/outputs/{selectedDataset}" download>↓ Export CSV</a>
          </div>
        </div>

        <!-- Job running banner -->
        {#if activeJob}
        <div class="ds-job-banner">
          <span class="ds-job-dot running"></span>
          {activeJob.type === 'index' ? 'Creating' : 'Updating'} dataset…
          <a href="#monitor" class="ds-job-link">Watch in Monitor →</a>
        </div>
        {/if}

        <!-- Update panel -->
        {#if activePanel === 'update'}
        <DatasetUpdatePanel
          dataset={selectedDataset}
          {schemas}
          initialSchema={schemaId}
          onSubmit={handleUpdateSubmit}
        />
        {/if}

        <!-- Records + Chat side by side -->
        <div class="ds-content-row">
          <div class="ds-records-col">
            <div class="ds-section-label">Records</div>
            <div class="records-card">
              <RecordsTab file={selectedDataset} refreshTick={recordsTick} schemaId={schemaId || null} />
            </div>
          </div>

          <!-- Chat panel -->
          <div class="ds-chat-col">
          <div class="ds-section-label">Assistant</div>
          <ChatPanel jobId={activeJob?.id} />
          </div>
        </div>

      {/if}
    </div>

  </div>
</div>

<style>
  /* Root */
  .ds-root {
    font-family: 'DM Sans', sans-serif;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .ds-layout {
    display: flex;
    gap: 1.5rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    align-items: stretch;
  }

  /* ── Main ── */
  .ds-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }

  .ds-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
    font-size: 0.92rem;
    color: #9b9892;
    font-family: 'DM Sans', sans-serif;
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 14px;
  }

  /* Top bar */
  .ds-topbar {
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 14px 14px 0 0;
    padding: 1rem 1.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .ds-topbar-left {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .ds-topbar-name {
    font-family: 'DM Sans', sans-serif;
    font-weight: 600;
    font-size: 0.95rem;
    color: #0e0d0b;
  }

  .ds-topbar-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }

  .ds-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.38rem 0.9rem;
    border-radius: 7px;
    font-size: 0.82rem;
    font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    border: 1.5px solid #dddbd5;
    background: #fff;
    color: #0e0d0b;
    text-decoration: none;
    transition: border-color 0.12s, background 0.12s;
  }
  .ds-btn:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-btn:hover { border-color: #aaa; background: #f5f3ee; }

  .ds-btn--update { border-color: #fcd34d; color: #92400e; background: #fffbeb; }
  .ds-btn--update:hover { border-color: #f59e0b; background: #fef3c7; }
  .ds-btn--active { box-shadow: inset 0 0 0 1.5px currentColor; }

  /* Job banner */
  .ds-job-banner {
    display: flex; align-items: center; gap: 0.75rem;
    background: #fffbeb; border: 1px solid #fcd34d;
    border-radius: 8px; padding: 0.6rem 1rem;
    margin-bottom: 0.75rem;
    font-size: 0.85rem; font-weight: 500; color: #92400e;
    font-family: 'DM Sans', sans-serif;
  }
  .ds-job-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #f59e0b; flex-shrink: 0;
  }
  .ds-job-dot.running { animation: job-pulse 1.4s ease-in-out infinite; }
  @keyframes job-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .ds-job-link {
    color: #0e7490; font-weight: 600; text-decoration: none; margin-left: auto;
    font-size: 0.82rem;
  }
  .ds-job-link:hover { text-decoration: underline; }

  /* Records + Chat two-column layout */
  .ds-content-row {
    display: flex;
    gap: 0.75rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    align-items: stretch;
  }

  .ds-records-col {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .ds-chat-col {
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  /* Section label above records */
  .ds-section-label {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9b9892;
    padding: 0.75rem 0.25rem 0.4rem;
  }

  /* Records card wrapper */
  .records-card {
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid #dddbd5;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    margin-top: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
