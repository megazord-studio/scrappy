<script lang="ts">
  import { startUpdateJob } from '../lib/api';

  const {
    dataset,
    schemas,
    initialSchema = '',
    onSubmit,
  }: {
    dataset: string;
    schemas: Array<{ id: string; display_name: string }>;
    initialSchema?: string;
    onSubmit: () => void;
  } = $props();

  let updateSchema = $state('');
  let updateFilter = $state('');
  let submitting = $state(false);

  // Sync initialSchema when it becomes available (resolved asynchronously from parent)
  $effect(() => {
    const s = initialSchema;
    if (s && !updateSchema) {
      updateSchema = s;
    }
  });

  async function startUpdate() {
    if (!dataset || !updateSchema) return;
    submitting = true;
    await startUpdateJob({ input: dataset, schema: updateSchema, filter: updateFilter || undefined });
    submitting = false;
    onSubmit();
  }
</script>

<div class="ds-action-panel ds-panel--update">
  <div class="ds-panel-title">↻ Update · {dataset}</div>
  <div class="ds-panel-fields">
    <div class="ds-field">
      <label class="ds-label" for="update-schema">Schema</label>
      <select id="update-schema" class="ds-select" bind:value={updateSchema}>
        {#each schemas as s}<option value={s.id}>{s.display_name}</option>{/each}
      </select>
    </div>
    <div class="ds-field">
      <label class="ds-label" for="update-filter">Filter (optional)</label>
      <input id="update-filter" class="ds-input" bind:value={updateFilter} placeholder="e.g. provider name…" />
    </div>
  </div>
  <button class="ds-submit" onclick={startUpdate} disabled={submitting || !updateSchema}>
    {submitting ? 'Starting…' : '↻ Run update'}
  </button>
</div>

<style>
  /* Action panel */
  .ds-action-panel {
    background: #fff; border: 1px solid #dddbd5; border-radius: 12px;
    padding: 1.25rem 1.5rem; margin-bottom: 0.75rem;
  }
  .ds-panel--update { border-top: 3px solid #f59e0b; }

  .ds-panel-title {
    font-family: 'Syne', sans-serif; font-weight: 700;
    font-size: 0.82rem; color: #0e0d0b; margin-bottom: 1rem;
    letter-spacing: -0.01em;
  }

  .ds-panel-fields {
    display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;
  }
  .ds-field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 160px; }

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
  .ds-submit:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-submit:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
  .ds-submit:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
