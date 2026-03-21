<script lang="ts">
  import { startIndexJob } from '../../lib/api';
  import { jobsStore } from '../../stores/jobs.svelte';
  import { dashStore } from '../../stores/dashboard.svelte';

  const {
    schemas,
    outputs = [],
    selectedDataset = null,
    onStarted,
  }: {
    schemas: Array<{ id: string; display_name: string }>;
    outputs?: string[];
    selectedDataset?: string | null;
    onStarted?: () => void;
  } = $props();

  let topic = $state('');
  let selectedSchema = $state('');
  let output = $state('');
  let maxIter = $state('');
  let seedUrls = $state('');
  let seedModalOpen = $state(false);
  let loading = $state(false);
  let topicError = $state('');

  $effect(() => {
    if (schemas.length && !selectedSchema) selectedSchema = schemas[0].id;
  });

  $effect(() => {
    if (selectedDataset && !output) output = selectedDataset;
  });

  const seedCount = $derived(seedUrls.split('\n').map(s => s.trim()).filter(Boolean).length);

  async function handleIndex() {
    if (!topic.trim()) { topicError = 'Enter a topic'; return; }
    topicError = '';
    loading = true;
    const cleanOutput = output.trim().replace(/\.csv$/i, '') || 'results';
    const cleanSeedUrls = seedUrls.split('\n').map(s => s.trim()).filter(Boolean).join(',');
    const res = await startIndexJob({
      topic: topic.trim(),
      schema: selectedSchema,
      output: cleanOutput,
      ...(maxIter ? { maxIterations: Number(maxIter) } : {}),
      ...(cleanSeedUrls ? { seedUrls: cleanSeedUrls } : {}),
    });
    loading = false;
    await jobsStore.refresh();
    if (res.id) {
      await dashStore.openJob(res.id);
      onStarted?.();
    }
  }
</script>

<div class="inline-form">
  <div class="field grow2">
    <label>Topic</label>
    <input type="text" bind:value={topic} placeholder="3A Fonds Konto Schweiz Zinssatz" oninput={() => topicError = ''} />
    {#if topicError}<span class="field-error">{topicError}</span>{/if}
  </div>
  <div class="field">
    <label>Schema</label>
    <select bind:value={selectedSchema}>
      {#each schemas as s}
        <option value={s.id}>{s.display_name}</option>
      {/each}
    </select>
  </div>
  <div class="field">
    <label>Dataset</label>
    <input type="text" bind:value={output} placeholder="results" list="index-dataset-list" autocomplete="off" />
    <datalist id="index-dataset-list">
      {#each outputs as o}
        <option value={o} />
      {/each}
    </datalist>
  </div>
  <div class="field narrow">
    <label>Iterations</label>
    <input type="number" bind:value={maxIter} placeholder="40" min="1" max="200" />
  </div>
  <div class="field submit">
    <label>&nbsp;</label>
    <div style="display:flex;gap:0.35rem">
      <button class="seed-btn" class:has-seeds={seedCount > 0} onclick={() => seedModalOpen = true} title="Seed URLs">
        ⊕ Seeds{#if seedCount > 0}<span class="seed-count">{seedCount}</span>{/if}
      </button>
      <button disabled={loading} onclick={handleIndex}>
        {loading ? '…' : '▶ Run'}
      </button>
    </div>
  </div>
</div>

{#if seedModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="seed-backdrop" onclick={() => seedModalOpen = false}>
    <div class="seed-modal" onclick={(e) => e.stopPropagation()}>
      <div class="seed-modal-title">Seed URLs</div>
      <p class="seed-hint">One URL per line — scraped before the agent starts searching.</p>
      <textarea bind:value={seedUrls} rows="8" placeholder="https://example.com/providers&#10;https://example.com/list" autofocus></textarea>
      <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.75rem">
        <button class="btn-secondary" onclick={() => { seedUrls = ''; }}>Clear</button>
        <button onclick={() => seedModalOpen = false}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .inline-form {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 120px;
    flex: 1;
  }
  .field.grow2 { flex: 2; }
  .field.narrow { flex: 0 0 80px; min-width: 0; }
  .field.submit { flex: 0 0 auto; }
  label { font-size: 0.68rem; color: #888; margin: 0; }
  input, select { margin: 0; }
  button { margin: 0; white-space: nowrap; }
  .field-error { font-size: 0.65rem; color: #f87171; margin-top: 0.1rem; }

  .seed-btn {
    background: #111;
    border: 1px solid #2a2a2a;
    color: #666;
    border-radius: 4px;
    padding: 0.3rem 0.45rem;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }
  .seed-btn:hover { border-color: #444; color: #999; }
  .seed-btn.has-seeds { border-color: #3a4a2a; color: #8bc34a; }
  .seed-count {
    font-size: 0.65rem;
    background: #3a4a2a;
    color: #8bc34a;
    border-radius: 3px;
    padding: 0 0.25rem;
    line-height: 1.4;
  }

  .seed-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .seed-modal {
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    width: min(480px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .seed-modal-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ccc;
  }
  .seed-hint {
    font-size: 0.72rem;
    color: #888;
    margin: 0;
  }
  .seed-modal textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: monospace;
    font-size: 0.75rem;
    resize: vertical;
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #ccc;
    border-radius: 4px;
    padding: 0.5rem;
  }
  .btn-secondary {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #666;
    border-radius: 4px;
    padding: 0.3rem 0.75rem;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .btn-secondary:hover { color: #999; border-color: #444; }
</style>
