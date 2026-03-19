<script lang="ts">
  import { startUpdateJob } from '../../lib/api';
  import { jobsStore } from '../../stores/jobs.svelte';
  import { dashStore } from '../../stores/dashboard.svelte';

  const {
    schemas,
    selectedDataset,
    onStarted,
  }: {
    schemas: Array<{ id: string; display_name: string }>;
    selectedDataset: string | null;
    onStarted?: () => void;
  } = $props();

  let selectedSchema = $state('');
  let filter = $state('');
  let loading = $state(false);

  // Auto-select schema from the most recent job that used this dataset
  $effect(() => {
    if (!schemas.length) return;
    const lastJob = jobsStore.jobs.find(j =>
      (j.params.output === selectedDataset || j.params.input === selectedDataset) && j.params.schema
    );
    if (!lastJob) {
      if (!selectedSchema) selectedSchema = schemas[0].id;
      return;
    }
    const found = schemas.find(s => s.id === lastJob.params.schema);
    if (found) selectedSchema = found.id;
  });

  async function handleUpdate() {
    if (!selectedDataset) { alert('No dataset selected'); return; }
    loading = true;
    const body: { input: string; schema: string; filter?: string } = {
      input: selectedDataset,
      schema: selectedSchema,
    };
    if (filter.trim()) body.filter = filter.trim();
    const res = await startUpdateJob(body);
    loading = false;
    await jobsStore.refresh();
    if (res.id) {
      await dashStore.openJob(res.id);
      onStarted?.();
    }
  }
</script>

<div class="inline-form">
  {#if !selectedDataset}
    <span style="font-size:0.75rem;color:#888">Select a dataset first</span>
  {:else}
    <div class="field">
      <label>Schema</label>
      <select bind:value={selectedSchema}>
        {#each schemas as s}
          <option value={s.id}>{s.display_name}</option>
        {/each}
      </select>
    </div>
    <div class="field grow">
      <label>Filter provider <span style="color:#666">(optional)</span></label>
      <input type="text" bind:value={filter} placeholder="e.g. viac or tellco" />
    </div>
    <div class="field submit">
      <label>&nbsp;</label>
      <button disabled={loading} onclick={handleUpdate}>
        {loading ? '…' : '↻ Run'}
      </button>
    </div>
  {/if}
</div>

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
  .field.grow { flex: 2; }
  .field.submit { flex: 0 0 auto; }
  label { font-size: 0.68rem; color: #888; margin: 0; }
  input, select { margin: 0; }
  button { margin: 0; white-space: nowrap; }
</style>
