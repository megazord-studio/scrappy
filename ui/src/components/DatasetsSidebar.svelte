<script lang="ts">
  const {
    datasets,
    schemas,
    selectedDataset,
    activePanel,
    onSelectDataset,
    onDelete,
    onNewDataset,
    onSchemaEdit,
    onDeleteSchema,
    onNewSchema,
    onRefresh,
  }: {
    datasets: string[];
    schemas: Array<{ id: string; display_name: string }>;
    selectedDataset: string | null;
    activePanel: 'update' | 'create' | null;
    onSelectDataset: (name: string) => void;
    onDelete: (name: string) => void;
    onNewDataset: () => void;
    onSchemaEdit: (id: string) => void;
    onDeleteSchema: (id: string) => void;
    onNewSchema: () => void;
    onRefresh: () => void;
  } = $props();
</script>

<aside class="ds-sidebar">

  <!-- New Dataset button -->
  <button
    class="ds-new-btn"
    class:ds-new-btn--active={activePanel === 'create'}
    onclick={onNewDataset}
  >+ New Dataset</button>

  <!-- Datasets section -->
  <div class="ds-sidebar-sec-header">
    <span>Datasets</span>
    <button class="ds-sb-icon-btn" onclick={onRefresh} title="Refresh">↺</button>
  </div>
  {#if datasets.length === 0}
    <div class="ds-sidebar-empty">No datasets yet</div>
  {:else}
    {#each datasets as name (name)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="ds-card"
        class:ds-card--active={selectedDataset === name}
        onclick={() => onSelectDataset(name)}
      >
        <span class="ds-card-dot"></span>
        <div class="ds-card-name">{name}</div>
        <div class="ds-card-acts">
          <button
            class="ds-card-act-btn"
            onclick={(e) => { e.stopPropagation(); onDelete(name); }}
            title="Delete dataset"
          >✕</button>
        </div>
      </div>
    {/each}
  {/if}

  <!-- Divider -->
  <div class="ds-sidebar-divider"></div>

  <!-- Schemas section -->
  <div class="ds-sidebar-sec-header">
    <span>Schemas</span>
    <button class="ds-sb-icon-btn" onclick={onNewSchema} title="New schema">+</button>
  </div>
  {#if schemas.length === 0}
    <div class="ds-sidebar-empty">No schemas yet</div>
  {:else}
    {#each schemas as s}
      <div class="ds-schema-card">
        <span class="ds-schema-name">{s.display_name}</span>
        <div class="ds-schema-acts">
          <button class="ds-schema-btn" onclick={() => onSchemaEdit(s.id)}>edit</button>
          <button class="ds-schema-btn ds-schema-btn--del" onclick={() => onDeleteSchema(s.id)}>del</button>
        </div>
      </div>
    {/each}
  {/if}

</aside>

<style>
  /* New Dataset button */
  .ds-new-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.9rem;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    border: 1.5px solid #67e8f9;
    background: #ecfeff;
    color: #0e7490;
    transition: border-color 0.12s, background 0.12s;
    margin-bottom: 0.25rem;
  }
  .ds-new-btn:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-new-btn:hover { border-color: #22d3ee; background: #cffafe; }
  .ds-new-btn--active { border-color: #22d3ee; background: #cffafe; box-shadow: inset 0 0 0 1.5px #22d3ee; }

  /* ── Sidebar ── */
  .ds-sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
  }

  .ds-sidebar-sec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #6b6860;
    margin-bottom: 0.1rem;
    padding: 0 0.25rem;
  }

  .ds-sb-icon-btn {
    all: unset;
    cursor: pointer;
    color: #9b9892;
    font-size: 0.95rem;
    line-height: 1;
    transition: color 0.15s;
  }
  .ds-sb-icon-btn:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-sb-icon-btn:hover { color: #0e0d0b; }

  .ds-sidebar-empty {
    font-size: 0.85rem;
    color: #9b9892;
    padding: 0.5rem 0.25rem;
  }

  .ds-sidebar-divider {
    height: 1px;
    background: #e8e6e0;
    margin: 0.5rem 0;
    flex-shrink: 0;
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
    position: relative;
  }
  .ds-card:hover {
    border-color: #b8b6b0;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .ds-card--active {
    border-color: #22d3ee;
    box-shadow: 0 1px 6px rgba(34,211,238,0.12);
    background: #f0fdff;
  }

  .ds-card-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d0cec8;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .ds-card--active .ds-card-dot { background: #22d3ee; }
  .ds-card:hover:not(.ds-card--active) .ds-card-dot { background: #b0aea8; }

  .ds-card-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #0e0d0b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .ds-card-acts {
    display: flex;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .ds-card:hover .ds-card-acts { opacity: 1; }

  .ds-card-act-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.72rem;
    color: #9b9892;
    padding: 0.15rem 0.25rem;
    border-radius: 3px;
    line-height: 1;
    transition: color 0.12s;
  }
  .ds-card-act-btn:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-card-act-btn:hover { color: #dc2626; }

  /* Schema cards */
  .ds-schema-card {
    background: #ffffff;
    border: 1px solid #e8e6e0;
    border-radius: 8px;
    padding: 0.55rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .ds-schema-card:hover {
    border-color: #b8b6b0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }

  .ds-schema-name {
    font-size: 0.82rem;
    font-weight: 500;
    color: #0e0d0b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .ds-schema-acts {
    display: flex;
    gap: 0.25rem;
    opacity: 0.4;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .ds-schema-card:hover .ds-schema-acts { opacity: 1; }

  .ds-schema-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.67rem;
    font-weight: 600;
    color: #6b6860;
    padding: 0.12rem 0.4rem;
    border: 1px solid #dddbd5;
    border-radius: 4px;
    line-height: 1.4;
    font-family: 'DM Sans', sans-serif;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
    background: #f5f3ee;
  }
  .ds-schema-btn:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ds-schema-btn:hover { color: #0e0d0b; border-color: #aaa; background: #ececea; }
  .ds-schema-btn--del:hover { color: #dc2626; border-color: #fca5a5; background: #fef2f2; }
</style>
