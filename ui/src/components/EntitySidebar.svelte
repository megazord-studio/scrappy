<script lang="ts">
  import type { Entity } from '../lib/types';

  const {
    entities,
    selectedKey,
    onSelect,
    onRefresh,
  }: {
    entities: Entity[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
    onRefresh: () => void;
  } = $props();

  let filter = $state('');

  const filtered = $derived(
    filter.trim()
      ? entities.filter(e => e.display_name.toLowerCase().includes(filter.toLowerCase()))
      : entities
  );
</script>

<div class="en-sidebar">
  <div class="en-sb-header">
    <span class="en-sb-title">Entities</span>
    <button class="en-sb-icon-btn" onclick={onRefresh} title="Refresh">↺</button>
  </div>

  <div class="en-sb-search-wrap">
    <input class="en-sb-search" bind:value={filter} placeholder="Filter…" />
  </div>

  {#if filtered.length === 0}
    <div class="en-sb-empty">
      {entities.length === 0 ? 'No entities yet — add an entity field to a schema' : 'No matches'}
    </div>
  {:else}
    <div class="en-sb-list">
      {#each filtered as e (e.normalized_name)}
        <button
          class="en-card"
          class:en-card--active={selectedKey === e.normalized_name}
          onclick={() => onSelect(e.normalized_name)}
        >
          {#if e.logo_url}
            <img class="en-card-logo" src={e.logo_url} alt="" />
          {:else}
            <span class="en-card-dot"></span>
          {/if}
          <div class="en-card-body">
            <div class="en-card-name">{e.display_name}</div>
            <div class="en-card-meta">
              <span class="en-badge en-badge--records">{e.record_count}</span>
              <span class="en-badge en-badge--datasets">{e.datasets.length} {e.datasets.length === 1 ? 'dataset' : 'datasets'}</span>
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .en-sidebar {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 14px;
    overflow: hidden;
    font-family: 'DM Sans', sans-serif;
  }

  .en-sb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem 0.6rem;
    border-bottom: 1px solid #ece9e3;
    flex-shrink: 0;
  }
  .en-sb-title {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9b9892;
  }
  .en-sb-icon-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.9rem;
    color: #9b9892;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
    transition: color 0.12s, background 0.12s;
  }
  .en-sb-icon-btn:hover { color: #0e0d0b; background: #f5f3ee; }

  .en-sb-search-wrap {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #ece9e3;
    flex-shrink: 0;
  }
  .en-sb-search {
    all: unset;
    width: 100%;
    box-sizing: border-box;
    background: #f9f8f5;
    border: 1px solid #dddbd5;
    border-radius: 6px;
    padding: 0.35rem 0.65rem;
    font-size: 0.8rem;
    color: #0e0d0b;
    transition: border-color 0.12s;
  }
  .en-sb-search:focus { border-color: #22d3ee; outline: none; }
  .en-sb-search::placeholder { color: #b8b6b0; }

  .en-sb-empty {
    padding: 1.5rem 1rem;
    font-size: 0.78rem;
    color: #9b9892;
    text-align: center;
    line-height: 1.5;
  }

  .en-sb-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.35rem 0;
  }

  .en-card {
    all: unset;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.85rem;
    cursor: pointer;
    transition: background 0.1s;
  }
  .en-card:hover { background: #f5f3ee; }
  .en-card--active { background: #ecfeff; }

  .en-card-logo {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    object-fit: contain;
    flex-shrink: 0;
    background: #f5f3ee;
  }
  .en-card-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #dddbd5;
    flex-shrink: 0;
  }
  .en-card--active .en-card-dot { background: #22d3ee; }

  .en-card-body {
    min-width: 0;
    flex: 1;
  }
  .en-card-name {
    font-size: 0.82rem;
    font-weight: 500;
    color: #0e0d0b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .en-card--active .en-card-name { color: #0e7490; }

  .en-card-meta {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.2rem;
    flex-wrap: wrap;
  }
  .en-badge {
    font-size: 0.62rem;
    font-weight: 600;
    border-radius: 10px;
    padding: 0.1rem 0.45rem;
    font-family: 'DM Sans', sans-serif;
  }
  .en-badge--records { background: #f0fdff; color: #0e7490; }
  .en-badge--datasets { background: #f5f3ee; color: #6b6860; }
</style>
