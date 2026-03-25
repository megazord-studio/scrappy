<script lang="ts">
  import { startIndexJob } from '../lib/api';

  const {
    schemas,
    datasets,
    onSubmit,
  }: {
    schemas: Array<{ id: string; display_name: string }>;
    datasets: string[];
    onSubmit: (params: { output: string }) => void;
  } = $props();

  let createTopic = $state('');
  let createSchema = $state('');
  let createOutput = $state('');
  let createIterations = $state(40);
  let createSeedUrls = $state('');
  let submitting = $state(false);

  async function startCreate() {
    if (!createTopic || !createSchema || !createOutput) return;
    submitting = true;
    const seedUrls = createSeedUrls.trim() || undefined;
    await startIndexJob({ topic: createTopic, schema: createSchema, output: createOutput, maxIterations: createIterations, seedUrls });
    submitting = false;
    onSubmit({ output: createOutput });
  }
</script>

<div class="ds-action-panel ds-panel--create">
  <div class="ds-panel-title">+ New Dataset</div>
  <div class="ds-panel-fields">
    <div class="ds-field ds-field--wide">
      <label class="ds-label" for="create-topic">Topic</label>
      <input id="create-topic" class="ds-input" bind:value={createTopic} placeholder="e.g. Swiss savings accounts…" />
    </div>
    <div class="ds-field">
      <label class="ds-label" for="create-schema">Schema</label>
      <select id="create-schema" class="ds-select" bind:value={createSchema}>
        <option value="">Select schema…</option>
        {#each schemas as s}<option value={s.id}>{s.display_name}</option>{/each}
      </select>
    </div>
    <div class="ds-field">
      <label class="ds-label" for="create-output">Dataset name</label>
      <input id="create-output" class="ds-input" bind:value={createOutput} placeholder="my-dataset" list="ds-outputs-list" />
      <datalist id="ds-outputs-list">{#each datasets as o}<option value={o}></option>{/each}</datalist>
    </div>
    <div class="ds-field">
      <label class="ds-label" for="create-iterations">Max iterations</label>
      <input id="create-iterations" class="ds-input" type="number" bind:value={createIterations} min="1" max="200" />
    </div>
    <div class="ds-field ds-field--wide">
      <label class="ds-label" for="create-seed-urls">Seed URLs <span class="ds-label-hint">(one per line, optional)</span></label>
      <textarea id="create-seed-urls" class="ds-input ds-textarea" bind:value={createSeedUrls} placeholder="https://example.com/products&#10;https://other.com/compare" rows="3"></textarea>
    </div>
  </div>
  <button class="ds-submit ds-submit--teal" onclick={startCreate} disabled={submitting || !createTopic || !createSchema || !createOutput}>
    {submitting ? 'Starting…' : '→ Create dataset'}
  </button>
</div>

<style>
  /* Action panel */
  .ds-action-panel {
    background: #fff; border: 1px solid #dddbd5; border-radius: 12px;
    padding: 1.25rem 1.5rem; margin-bottom: 0.75rem;
  }
  .ds-panel--create { border-top: 3px solid #22d3ee; }

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
  .ds-label-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: #9b9890; }

  .ds-input, .ds-select {
    all: unset;
    background: #f9f8f5; border: 1px solid #dddbd5; border-radius: 7px;
    padding: 0.45rem 0.75rem; font-size: 0.85rem; color: #0e0d0b;
    font-family: 'DM Sans', sans-serif; width: 100%; box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .ds-input:focus, .ds-select:focus { border-color: #22d3ee; outline: none; }
  .ds-input::placeholder { color: #b8b6b0; }
  .ds-textarea { resize: vertical; min-height: 4.5rem; }

  .ds-submit {
    all: unset; cursor: pointer;
    display: inline-flex; align-items: center;
    background: #0e0d0b; color: #f5f3ee;
    padding: 0.5rem 1.25rem; border-radius: 8px;
    font-size: 0.85rem; font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    transition: opacity 0.12s, transform 0.12s;
  }
  .ds-submit:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-submit:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
  .ds-submit:disabled { opacity: 0.4; cursor: not-allowed; }
  .ds-submit--teal { background: #22d3ee; color: #0e0d0b; }
</style>
