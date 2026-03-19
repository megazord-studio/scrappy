<script lang="ts">
  import IndexTab from './tabs/IndexTab.svelte';
  import UpdateTab from './tabs/UpdateTab.svelte';
  import RecordsTab from './RecordsTab.svelte';
  import { dashStore } from '../stores/dashboard.svelte';
  import { getOutputs, deleteOutput } from '../lib/api';

  const {
    schemas,
    outputs: initialOutputs,
    initialDataset = null,
    onSchemaEdit,
    onNewSchema,
    onSelectsReload,
  }: {
    schemas: Array<{ id: string; display_name: string }>;
    outputs: string[];
    initialDataset?: string | null;
    onSchemaEdit: (id: string) => void;
    onNewSchema: () => void;
    onSelectsReload: () => void;
  } = $props();

  let datasets = $state<string[]>(initialOutputs);
  let selectedDataset = $state<string | null>(initialDataset ?? null);
  let recordsTick = $state(0);
  let activePanel = $state<'index' | 'update' | null>(null);

  $effect(() => { datasets = initialOutputs; });

  async function refreshDatasets() {
    const { outputs } = await getOutputs();
    datasets = outputs;
    onSelectsReload();
  }

  function openDataset(name: string) {
    selectedDataset = name;
    recordsTick++;
  }

  function togglePanel(panel: 'index' | 'update') {
    activePanel = activePanel === panel ? null : panel;
  }

  function handleDatasetClick(name: string) {
    openDataset(name);
    if (activePanel === 'index') activePanel = null;
  }

  function handleUpdateClick(name: string) {
    openDataset(name);
    activePanel = (activePanel === 'update' && activeFile === name) ? null : 'update';
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete dataset "${name}"?`)) return;
    await deleteOutput(name);
    if (selectedDataset === name) { selectedDataset = null; activePanel = null; }
    await refreshDatasets();
  }

  async function handleDeleteSchema(id: string) {
    if (!confirm(`Delete schema "${id}"? This cannot be undone.`)) return;
    const res = await fetch(`/schemas/${id}`, { method: 'DELETE' });
    const data = await res.json() as { error?: string };
    if (!res.ok) { alert(data.error); return; }
    onSelectsReload();
  }

  function onJobStarted() {
    activePanel = null;
  }

  const activeFile = $derived(selectedDataset ?? dashStore.recordsFile ?? null);
</script>

<div class="scrape-layout">

  <!-- ── SIDEBAR ── -->
  <aside class="scrape-sidebar">

    <div class="sidebar-section">
      <div class="sidebar-sec-header">
        <span>Datasets</span>
        <button class="sb-icon-btn" onclick={refreshDatasets} title="Refresh">↺</button>
      </div>

      {#if datasets.length === 0}
        <div class="sidebar-empty">No datasets yet</div>
      {:else}
        {#each datasets as name (name)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class="dataset-item"
            class:active={activeFile === name}
            onclick={() => handleDatasetClick(name)}
          >
            <span class="ds-dot" class:active={activeFile === name}></span>
            <span class="ds-name">{name}</span>
            <div class="ds-actions">
              <button
                class="ds-act-btn"
                class:panel-open={activePanel === 'update' && activeFile === name}
                onclick={(e) => { e.stopPropagation(); handleUpdateClick(name); }}
                title="Update"
              >↻</button>
              <a
                class="ds-act-btn"
                href="/outputs/{name}"
                onclick={(e) => e.stopPropagation()}
                title="Download CSV"
              >↓</a>
              <button
                class="ds-act-btn del"
                onclick={(e) => { e.stopPropagation(); handleDelete(name); }}
                title="Delete dataset"
              >✕</button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="sidebar-section sidebar-schemas">
      <div class="sidebar-sec-header">
        <span>Schemas</span>
        <button class="sb-icon-btn" onclick={onNewSchema} title="New schema">+</button>
      </div>
      {#if schemas.length === 0}
        <div class="sidebar-empty">No schemas yet</div>
      {:else}
        {#each schemas as s}
          <div class="schema-item">
            <span class="schema-name">{s.display_name}</span>
            <div class="schema-acts">
              <button class="schema-btn" onclick={() => onSchemaEdit(s.id)}>edit</button>
              <button class="schema-btn del" onclick={() => handleDeleteSchema(s.id)}>del</button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

  </aside>

  <!-- ── MAIN CONTENT ── -->
  <div class="scrape-content">

    <!-- Toolbar -->
    <div class="content-toolbar">
      <div class="toolbar-left">
        {#if activeFile}
          <span class="toolbar-dataset">{activeFile}</span>
        {:else}
          <span class="toolbar-hint">select a dataset →</span>
        {/if}
      </div>
      <button
        class="new-index-btn"
        class:active={activePanel === 'index'}
        onclick={() => togglePanel('index')}
      >+ Index</button>
    </div>

    <!-- Inline panel (index or update) -->
    {#if activePanel === 'index'}
      <div class="content-panel panel-index">
        <div class="panel-label">New Index Job</div>
        <IndexTab {schemas} outputs={datasets} selectedDataset={activeFile} onStarted={onJobStarted} />
      </div>
    {:else if activePanel === 'update'}
      <div class="content-panel panel-update">
        <div class="panel-label">Update · {activeFile}</div>
        <UpdateTab {schemas} selectedDataset={activeFile} onStarted={onJobStarted} />
      </div>
    {/if}

    <!-- Records -->
    <div class="records-area">
      {#if activeFile}
        <RecordsTab
          file={activeFile}
          refreshTick={activeFile === selectedDataset ? recordsTick : dashStore.recordsRefreshTick}
        />
      {:else}
        <div class="dash-empty" style="height:320px">Select a dataset from the sidebar</div>
      {/if}
    </div>

  </div>
</div>

<style>
  .scrape-layout {
    display: flex;
    gap: 0;
    min-height: 0;
    min-width: 0;
  }

  /* ── Sidebar ── */
  .scrape-sidebar {
    width: 210px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #1e1e1e;
    margin-right: 1.1rem;
    padding-right: 0.85rem;
    gap: 1.5rem;
    font-family: "IBM Plex Mono", "Fira Code", monospace;
    background: #0b0b0b;
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .sidebar-schemas { margin-top: auto; }

  .sidebar-sec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #666;
    padding-bottom: 0.45rem;
    margin-bottom: 0.3rem;
    border-bottom: 1px solid #202020;
  }

  .sb-icon-btn {
    all: unset;
    cursor: pointer;
    color: #666;
    font-size: 0.9rem;
    line-height: 1;
    transition: color 0.15s;
  }
  .sb-icon-btn:hover { color: #bbb; }

  .sidebar-empty {
    font-size: 0.67rem;
    color: #444;
    padding: 0.35rem 0;
  }

  /* Dataset items */
  .dataset-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.38rem 0.45rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.1s;
    position: relative;
  }
  .dataset-item:hover { background: #151515; }
  .dataset-item.active { background: #0e1e1e; }

  .ds-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #333;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .ds-dot.active { background: #22d3ee; }

  .ds-name {
    font-size: 0.72rem;
    color: #bbb;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }
  .dataset-item.active .ds-name { color: #e8e8e8; }
  .dataset-item:hover .ds-name { color: #ddd; }

  .ds-actions {
    display: flex;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .dataset-item:hover .ds-actions { opacity: 1; }
  .dataset-item.active .ds-actions { opacity: 1; }

  .ds-act-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.72rem;
    color: #666;
    padding: 0.15rem 0.25rem;
    border-radius: 2px;
    line-height: 1;
    text-decoration: none;
    transition: color 0.12s;
  }
  .ds-act-btn:hover { color: #ccc; }
  .ds-act-btn.del:hover { color: #f87171; }
  .ds-act-btn.panel-open { color: #22d3ee; }

  /* Schema items */
  .schema-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.32rem 0.45rem;
    border-radius: 3px;
    transition: background 0.1s;
  }
  .schema-item:hover { background: #131313; }

  .schema-name {
    font-size: 0.7rem;
    color: #999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .schema-acts {
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .schema-item:hover .schema-acts { opacity: 1; }

  .schema-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.6rem;
    color: #666;
    padding: 0.12rem 0.28rem;
    border: 1px solid #252525;
    border-radius: 2px;
    line-height: 1.4;
    transition: color 0.12s, border-color 0.12s;
  }
  .schema-btn:hover { color: #bbb; border-color: #444; }
  .schema-btn.del:hover { color: #f87171; border-color: #4a2020; }

  /* ── Content ── */
  .scrape-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .content-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.65rem;
    gap: 0.75rem;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .toolbar-dataset {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.8rem;
    font-weight: 600;
    color: #ddd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar-hint {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.72rem;
    color: #444;
  }

  .new-index-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    color: #999;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 0.3rem 0.7rem;
    background: #0e0e0e;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .new-index-btn:hover { color: #ddd; border-color: #3a3a3a; }
  .new-index-btn.active { color: #22d3ee; border-color: #22d3ee; background: #051518; }

  /* Inline action panels */
  .content-panel {
    border-radius: 4px;
    padding: 0.85rem 1rem;
    margin-bottom: 0.75rem;
    border: 1px solid #1e1e1e;
    background: #0a0a0a;
  }
  .panel-index  { border-left: 2px solid #22d3ee; }
  .panel-update { border-left: 2px solid #f59e0b; }

  .panel-label {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.58rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #444;
    margin-bottom: 0.7rem;
  }
  .panel-index  .panel-label { color: #22d3ee; opacity: 0.6; }
  .panel-update .panel-label { color: #f59e0b; opacity: 0.6; }

  .records-area { min-width: 0; }
</style>
