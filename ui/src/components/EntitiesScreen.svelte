<script lang="ts">
  import { getEntities } from '../lib/api';
  import type { Entity } from '../lib/types';
  import EntitySidebar from './EntitySidebar.svelte';
  import EntityDetail from './EntityDetail.svelte';

  const { initialKey }: { initialKey?: string } = $props();

  let entities = $state<Entity[]>([]);
  let selectedKey = $state<string | null>(initialKey ?? null);
  let loading = $state(true);

  async function loadEntities() {
    loading = true;
    const res = await getEntities();
    entities = res.entities;
    loading = false;
    // Auto-select first entity if none selected
    if (!selectedKey && entities.length > 0) {
      selectedKey = entities[0].normalized_name;
    }
  }

  $effect(() => { loadEntities(); });

  // Sync initialKey from parent (deep-link navigation)
  $effect(() => {
    if (initialKey) selectedKey = initialKey;
  });

  const selectedEntity = $derived(
    selectedKey ? entities.find(e => e.normalized_name === selectedKey) ?? null : null
  );
</script>

<div class="en-root">
  <div class="en-layout">

    <EntitySidebar
      {entities}
      {selectedKey}
      onSelect={(key) => { selectedKey = key; }}
      onRefresh={loadEntities}
    />

    <div class="en-main">
      {#if loading && entities.length === 0}
        <div class="en-splash">Loading entities…</div>
      {:else if entities.length === 0}
        <div class="en-splash">
          <div class="en-splash-title">No entities yet</div>
          <div class="en-splash-body">Add an <strong>Entity field</strong> to a schema to start linking records across datasets.</div>
        </div>
      {:else if !selectedEntity}
        <div class="en-splash">Select an entity</div>
      {:else}
        <EntityDetail
          entityKey={selectedEntity.normalized_name}
          displayName={selectedEntity.display_name}
          description={selectedEntity.description}
          logoUrl={selectedEntity.logo_url}
          externalUrl={selectedEntity.external_url}
          onEnrichmentSaved={loadEntities}
          onDeleted={() => {
            loadEntities();
          }}
        />
      {/if}
    </div>

  </div>
</div>

<style>
  .en-root {
    font-family: 'DM Sans', sans-serif;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .en-layout {
    display: flex;
    gap: 1.5rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    align-items: stretch;
  }

  .en-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .en-splash {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 0.6rem;
    font-size: 0.92rem;
    color: #9b9892;
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
  }
  .en-splash-title {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 1rem;
    color: #0e0d0b;
  }
  .en-splash-body {
    font-size: 0.85rem;
    color: #6b6860;
    max-width: 320px;
    line-height: 1.6;
  }
</style>
