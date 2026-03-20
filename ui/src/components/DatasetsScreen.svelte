<script lang="ts">
  import { getRecords, startIndexJob, startUpdateJob, sendChat } from '../lib/api';

  const { outputs, schemas }: {
    outputs: string[];
    schemas: Array<{ id: string; display_name: string }>;
  } = $props();

  let selectedDataset = $state<string | null>(outputs[0] ?? null);
  let headers = $state<string[]>([]);
  let rows = $state<Record<string, unknown>[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let activePanel = $state<'index' | 'update' | null>(null);
  let indexTopic = $state('');
  let indexSchema = $state('');
  let indexOutput = $state('');
  let indexIterations = $state(40);
  let updateSchema = $state('');
  let updateFilter = $state('');
  let submitting = $state(false);
  let jobStatus = $state<{ id: string; type: string; status: string } | null>(null);
  let chatHistory = $state<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  let chatInput = $state('');
  let chatLoading = $state(false);

  $effect(() => {
    if (activePanel === 'update' && !updateSchema) {
      updateSchema = schemas[0]?.id ?? '';
    }
  });

  function cellClass(h: string): string {
    if (h === '_dataSource') return 'col-source';
    if (h === '_lastUpdated') return 'col-date';
    if (h.startsWith('_')) return 'col-system';
    return 'col-data';
  }

  function rowClass(row: Record<string, unknown>): string {
    const src = String(row['_dataSource'] ?? '');
    if (src === 'comparison') return 'row-changed';
    return '';
  }

  $effect(() => {
    if (!selectedDataset) return;
    loading = true;
    error = null;
    getRecords(selectedDataset).then(data => {
      headers = data.headers ?? [];
      rows = data.rows ?? [];
      loading = false;
    }).catch(e => {
      error = String(e);
      loading = false;
    });
  });

  function handleSelectDataset(name: string) {
    selectedDataset = name;
  }

  async function startIndex() {
    if (!indexTopic || !indexSchema || !indexOutput) return;
    submitting = true;
    const res = await startIndexJob({ topic: indexTopic, schema: indexSchema, output: indexOutput, maxIterations: String(indexIterations) });
    submitting = false;
    if (res.id) {
      jobStatus = { id: res.id, type: 'index', status: 'running' };
      activePanel = null;
    }
  }

  async function startUpdate() {
    if (!selectedDataset || !updateSchema) return;
    submitting = true;
    const res = await startUpdateJob({ input: selectedDataset, schema: updateSchema, filter: updateFilter || undefined });
    submitting = false;
    if (res.id) {
      jobStatus = { id: res.id, type: 'update', status: 'running' };
      activePanel = null;
    }
  }

  async function sendChatMsg() {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    chatInput = '';
    chatHistory = [...chatHistory, { role: 'user', content: msg }];
    chatLoading = true;
    const res = await sendChat(msg, jobStatus?.id, chatHistory.slice(0, -1));
    chatHistory = [...chatHistory, { role: 'assistant', content: res.reply ?? res.error ?? 'Error' }];
    chatLoading = false;
  }
</script>

<div class="ds-root">
  <div class="ds-layout">

    <!-- Sidebar -->
    <aside class="ds-sidebar">
      <div class="ds-sidebar-header">Datasets</div>
      {#if outputs.length === 0}
        <div class="ds-sidebar-empty">No datasets yet</div>
      {:else}
        {#each outputs as name (name)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class="ds-card"
            class:ds-card--active={selectedDataset === name}
            onclick={() => handleSelectDataset(name)}
          >
            <div class="ds-card-icon">{name.slice(0,2).toUpperCase()}</div>
            <div class="ds-card-name">{name}</div>
          </div>
        {/each}
      {/if}
    </aside>

    <!-- Main -->
    <div class="ds-main">
      {#if !selectedDataset}
        <div class="ds-empty">Select a dataset from the sidebar</div>
      {:else}
        <!-- Top bar -->
        <div class="ds-topbar">
          <div class="ds-topbar-left">
            <div class="ds-topbar-icon">{selectedDataset.slice(0,2).toUpperCase()}</div>
            <div>
              <div class="ds-topbar-name">{selectedDataset}</div>
              <div class="ds-topbar-meta">{rows.length} records</div>
            </div>
          </div>
          <div class="ds-topbar-actions">
            <div class="change-legend">
              <div class="legend-item"><div class="legend-dot ld-new"></div> Official</div>
              <div class="legend-item"><div class="legend-dot ld-changed"></div> Comparison</div>
            </div>
            <button class="ds-btn ds-btn--update" class:ds-btn--active={activePanel === 'update'} onclick={() => { activePanel = activePanel === 'update' ? null : 'update'; }}>↻ Update</button>
            <button class="ds-btn ds-btn--index" class:ds-btn--active={activePanel === 'index'} onclick={() => { activePanel = activePanel === 'index' ? null : 'index'; }}>+ New Dataset</button>
            <a class="ds-btn" href="/outputs/{selectedDataset}" download>↓ Export CSV</a>
          </div>
        </div>

        <!-- Job running banner -->
        {#if jobStatus}
        <div class="ds-job-banner" class:ds-job-banner--done={jobStatus.status !== 'running'}>
          <span class="ds-job-dot" class:running={jobStatus.status === 'running'}></span>
          {jobStatus.type === 'index' ? 'Indexing' : 'Updating'} dataset…
          <a href="/app" class="ds-job-link">Watch in Monitor →</a>
          <button class="ds-job-dismiss" onclick={() => jobStatus = null}>×</button>
        </div>
        {/if}

        <!-- Update panel -->
        {#if activePanel === 'update'}
        <div class="ds-action-panel ds-panel--update">
          <div class="ds-panel-title">↻ Update · {selectedDataset}</div>
          <div class="ds-panel-fields">
            <div class="ds-field">
              <label class="ds-label">Schema</label>
              <select class="ds-select" bind:value={updateSchema}>
                {#each schemas as s}<option value={s.id}>{s.display_name}</option>{/each}
              </select>
            </div>
            <div class="ds-field">
              <label class="ds-label">Filter (optional)</label>
              <input class="ds-input" bind:value={updateFilter} placeholder="e.g. provider name…" />
            </div>
          </div>
          <button class="ds-submit" onclick={startUpdate} disabled={submitting || !updateSchema}>
            {submitting ? 'Starting…' : '↻ Run update'}
          </button>
        </div>
        {/if}

        <!-- Index panel -->
        {#if activePanel === 'index'}
        <div class="ds-action-panel ds-panel--index">
          <div class="ds-panel-title">+ New Index Job</div>
          <div class="ds-panel-fields">
            <div class="ds-field ds-field--wide">
              <label class="ds-label">Topic</label>
              <input class="ds-input" bind:value={indexTopic} placeholder="e.g. Swiss savings accounts…" />
            </div>
            <div class="ds-field">
              <label class="ds-label">Schema</label>
              <select class="ds-select" bind:value={indexSchema}>
                <option value="">Select schema…</option>
                {#each schemas as s}<option value={s.id}>{s.display_name}</option>{/each}
              </select>
            </div>
            <div class="ds-field">
              <label class="ds-label">Output dataset name</label>
              <input class="ds-input" bind:value={indexOutput} placeholder="my-dataset" list="ds-outputs-list" />
              <datalist id="ds-outputs-list">{#each outputs as o}<option value={o}></option>{/each}</datalist>
            </div>
            <div class="ds-field">
              <label class="ds-label">Max iterations</label>
              <input class="ds-input" type="number" bind:value={indexIterations} min="1" max="200" />
            </div>
          </div>
          <button class="ds-submit ds-submit--teal" onclick={startIndex} disabled={submitting || !indexTopic || !indexSchema || !indexOutput}>
            {submitting ? 'Starting…' : '→ Start indexing'}
          </button>
        </div>
        {/if}

        <!-- Table -->
        {#if loading}
          <div class="ds-empty">Loading…</div>
        {:else if error}
          <div class="ds-empty ds-empty--error">{error}</div>
        {:else if rows.length === 0}
          <div class="ds-empty">No records in this dataset yet</div>
        {:else}
          <div class="ds-table-wrap">
            <table class="ds-table">
              <thead>
                <tr>
                  {#each headers as h}
                    <th class={cellClass(h)}>{h}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each rows as row}
                  <tr class={rowClass(row)}>
                    {#each headers as h}
                      {#if h === '_dataSource'}
                        <td class="col-source">
                          <span class="source-badge source-{String(row[h] ?? '')}">{row[h]}</span>
                        </td>
                      {:else}
                        <td class={cellClass(h)} title={String(row[h] ?? '')}>
                          {String(row[h] ?? '')}
                        </td>
                      {/if}
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <!-- Chat panel -->
        <div class="ds-chat">
          <div class="ds-chat-header">
            <span class="ds-chat-icon">✦</span>
            <span class="ds-chat-title">Ask about this dataset</span>
          </div>
          <div class="ds-chat-msgs">
            {#if chatHistory.length === 0}
              <div class="ds-chat-empty">Ask about trends, anomalies, or what to track next.</div>
            {/if}
            {#each chatHistory as msg}
              {#if msg.role === 'user'}
                <div class="ds-chat-bubble-user">{msg.content}</div>
              {:else}
                <div class="ds-chat-row-ai">
                  <span class="ds-chat-avatar">✦</span>
                  <div class="ds-chat-bubble-ai">{msg.content}</div>
                </div>
              {/if}
            {/each}
            {#if chatLoading}
              <div class="ds-chat-row-ai">
                <span class="ds-chat-avatar">✦</span>
                <span class="ds-chat-dots"><span></span><span></span><span></span></span>
              </div>
            {/if}
          </div>
          <div class="ds-chat-input-row">
            <input
              class="ds-chat-input"
              bind:value={chatInput}
              placeholder="Message Scrappy…"
              onkeydown={(e) => { if (e.key === 'Enter') sendChatMsg(); }}
              disabled={chatLoading}
            />
            <button class="ds-chat-send" onclick={sendChatMsg} disabled={chatLoading || !chatInput.trim()}>↑</button>
          </div>
        </div>

      {/if}
    </div>

  </div>
</div>

<style>
  /* Root — covers body's dark background */
  .ds-root {
    margin: -1.5rem;
    min-height: calc(100vh - 0px);
    background: #f5f3ee;
    font-family: 'DM Sans', sans-serif;
  }

  .ds-layout {
    display: flex;
    padding: 1.5rem;
    gap: 1.5rem;
    min-height: calc(100vh - 60px); /* 60px = nav height */
    align-items: flex-start;
  }

  /* ── Sidebar ── */
  .ds-sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ds-sidebar-header {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #6b6860;
    margin-bottom: 0.25rem;
    padding: 0 0.25rem;
  }

  .ds-sidebar-empty {
    font-size: 0.85rem;
    color: #9b9892;
    padding: 0.5rem 0.25rem;
  }

  .ds-card {
    background: #ffffff;
    border: 1px solid #dddbd5;
    border-radius: 10px;
    padding: 0.75rem 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .ds-card:hover {
    border-color: #b8b6b0;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .ds-card--active {
    border-color: #22d3ee;
    box-shadow: inset 3px 0 0 #22d3ee, 0 1px 6px rgba(34,211,238,0.12);
    background: #f0fdff;
  }

  .ds-card-icon {
    width: 32px;
    height: 32px;
    background: #0e0d0b;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 0.7rem;
    color: #f5f3ee;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }
  .ds-card--active .ds-card-icon { background: #22d3ee; color: #000; }

  .ds-card-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #0e0d0b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Main ── */
  .ds-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
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
  .ds-empty--error { color: #dc2626; }

  /* Top bar */
  .ds-topbar {
    background: #fff;
    border: 1px solid #dddbd5;
    border-bottom: none;
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

  .ds-topbar-icon {
    width: 40px;
    height: 40px;
    background: #0e0d0b;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 0.78rem;
    color: #f5f3ee;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .ds-topbar-name {
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 1rem;
    color: #0e0d0b;
    letter-spacing: -0.02em;
  }

  .ds-topbar-meta {
    font-size: 0.78rem;
    color: #6b6860;
    margin-top: 0.05rem;
  }

  .ds-topbar-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }

  .change-legend {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    font-size: 0.78rem;
    color: #6b6860;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 500;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .ld-new     { background: #059669; }
  .ld-changed { background: #d97706; }

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
  .ds-btn:hover { border-color: #aaa; background: #f5f3ee; }

  /* Action panel buttons */
  .ds-btn--update { border-color: #fcd34d; color: #92400e; background: #fffbeb; }
  .ds-btn--update:hover { border-color: #f59e0b; background: #fef3c7; }
  .ds-btn--index { border-color: #67e8f9; color: #0e7490; background: #ecfeff; }
  .ds-btn--index:hover { border-color: #22d3ee; background: #cffafe; }
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
  .ds-job-banner--done { background: #f0fdf4; border-color: #86efac; color: #166534; }
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
  .ds-job-dismiss {
    all: unset; cursor: pointer; color: #aaa; font-size: 1rem; line-height: 1;
    padding: 0 0.15rem;
  }
  .ds-job-dismiss:hover { color: #666; }

  /* Action panels */
  .ds-action-panel {
    background: #fff; border: 1px solid #dddbd5; border-radius: 12px;
    padding: 1.25rem 1.5rem; margin-bottom: 0.75rem;
  }
  .ds-panel--update { border-left: 3px solid #f59e0b; }
  .ds-panel--index  { border-left: 3px solid #22d3ee; }

  .ds-panel-title {
    font-family: 'Syne', sans-serif; font-weight: 700;
    font-size: 0.82rem; color: #0e0d0b; margin-bottom: 1rem;
    letter-spacing: -0.01em;
  }

  .ds-panel-fields {
    display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;
  }
  .ds-field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 160px; }
  .ds-field--wide { flex: 1; min-width: 280px; }

  .ds-label {
    font-size: 0.72rem; font-weight: 600; color: #6b6860;
    text-transform: uppercase; letter-spacing: 0.07em;
    font-family: 'DM Sans', sans-serif;
  }
  .ds-input, .ds-select {
    all: unset;
    background: #f9f8f5; border: 1px solid #dddbd5; border-radius: 7px;
    padding: 0.45rem 0.75rem; font-size: 0.85rem; color: #0e0d0b;
    font-family: 'DM Sans', sans-serif; width: 100%; box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .ds-input:focus, .ds-select:focus { border-color: #22d3ee; outline: none; }
  .ds-input::placeholder { color: #b8b6b0; }

  .ds-submit {
    all: unset; cursor: pointer;
    display: inline-flex; align-items: center;
    background: #0e0d0b; color: #f5f3ee;
    padding: 0.5rem 1.25rem; border-radius: 8px;
    font-size: 0.85rem; font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    transition: opacity 0.12s, transform 0.12s;
  }
  .ds-submit:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
  .ds-submit:disabled { opacity: 0.4; cursor: not-allowed; }
  .ds-submit--teal { background: #22d3ee; color: #0e0d0b; }

  /* Chat */
  .ds-chat {
    background: #fff; border: 1px solid #dddbd5; border-radius: 14px;
    margin-top: 0.75rem; overflow: hidden;
  }
  .ds-chat-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.65rem 1rem; border-bottom: 1px solid #f0eeea;
    background: #faf9f6;
  }
  .ds-chat-icon { color: #22d3ee; font-size: 0.72rem; }
  .ds-chat-title {
    font-family: 'Syne', sans-serif; font-weight: 700;
    font-size: 0.78rem; color: #0e0d0b; letter-spacing: -0.01em;
  }

  .ds-chat-msgs {
    padding: 0.85rem 1rem 0.5rem;
    display: flex; flex-direction: column; gap: 0.75rem;
    max-height: 220px; overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: #e2e0db transparent;
  }
  .ds-chat-empty {
    font-size: 0.82rem; color: #9b9892; text-align: center;
    padding: 0.5rem 0; font-family: 'DM Sans', sans-serif;
  }
  .ds-chat-bubble-user {
    align-self: flex-end; max-width: 80%;
    background: #f0f9ff; border: 1px solid #bae6fd;
    border-radius: 12px 12px 3px 12px;
    padding: 0.5rem 0.8rem; font-size: 0.82rem; color: #0e0d0b;
    font-family: 'DM Sans', sans-serif; line-height: 1.5;
  }
  .ds-chat-row-ai { display: flex; gap: 0.5rem; align-items: flex-start; max-width: 95%; }
  .ds-chat-avatar { color: #22d3ee; font-size: 0.72rem; margin-top: 0.25rem; flex-shrink: 0; }
  .ds-chat-bubble-ai {
    background: #faf9f6; border: 1px solid #e8e6e1;
    border-radius: 3px 12px 12px 12px;
    padding: 0.5rem 0.8rem; font-size: 0.82rem; color: #0e0d0b;
    font-family: 'DM Sans', sans-serif; line-height: 1.6; white-space: pre-wrap;
  }

  /* Thinking dots */
  .ds-chat-dots { display:flex; gap:3px; align-items:center; padding: 0.5rem 0.8rem; }
  .ds-chat-dots span {
    width:5px; height:5px; border-radius:50%; background:#22d3ee; opacity:0.4;
    animation: ds-dot 1.2s ease-in-out infinite;
  }
  .ds-chat-dots span:nth-child(2){animation-delay:0.2s}
  .ds-chat-dots span:nth-child(3){animation-delay:0.4s}
  @keyframes ds-dot{0%,100%{opacity:0.2;transform:scale(0.8)}50%{opacity:1;transform:scale(1.1)}}

  .ds-chat-input-row {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.65rem 1rem; border-top: 1px solid #f0eeea;
    background: #faf9f6;
  }
  .ds-chat-input {
    all: unset;
    flex: 1; font-size: 0.82rem; color: #0e0d0b;
    font-family: 'DM Sans', sans-serif;
    background: #fff; border: 1px solid #dddbd5; border-radius: 8px;
    padding: 0.45rem 0.75rem;
    transition: border-color 0.12s;
  }
  .ds-chat-input:focus { border-color: #22d3ee; outline: none; }
  .ds-chat-input::placeholder { color: #b8b6b0; }
  .ds-chat-input:disabled { opacity: 0.5; }
  .ds-chat-send {
    all: unset; cursor: pointer;
    width: 30px; height: 30px; border-radius: 8px;
    background: #22d3ee; color: #0e0d0b; font-size: 0.85rem;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: opacity 0.12s;
  }
  .ds-chat-send:disabled { background: #e2e0db; color: #9b9892; cursor: not-allowed; }
  .ds-chat-send:not(:disabled):hover { opacity: 0.85; }

  /* Table */
  .ds-table-wrap {
    overflow-x: auto;
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 0 0 14px 14px;
  }

  .ds-table {
    width: 100%;
    border-collapse: collapse;
  }

  .ds-table th {
    text-align: left;
    padding: 0.55rem 1.1rem;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #6b6860;
    background: #faf9f6;
    border-bottom: 1px solid #eeece8;
    white-space: nowrap;
  }

  .ds-table td {
    padding: 0.6rem 1.1rem;
    border-bottom: 1px solid #f5f3f0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    color: #0e0d0b;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ds-table tr:last-child td { border-bottom: none; }
  .ds-table tbody tr { transition: background 0.08s; }
  .ds-table tbody tr:hover td { background: #faf9f6 !important; }

  /* Column types */
  :global(.ds-table .col-date)   { color: #9b9892; font-size: 0.74rem; }
  :global(.ds-table .col-system) { color: #b8b6b0; font-size: 0.72rem; }

  /* Row states */
  .ds-table tbody tr.row-changed td { background: #fffbf0; }
  .ds-table tbody tr.row-changed td:first-child { box-shadow: inset 3px 0 0 #d97706; }

  /* Source badges */
  .source-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    font-size: 0.68rem;
    font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .source-official   { background: #dcfce7; color: #15803d; }
  .source-comparison { background: #fef9c3; color: #a16207; }
</style>
