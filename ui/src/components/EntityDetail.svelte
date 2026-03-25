<script lang="ts">
  import { getEntityRecords, saveEntity, deleteEntity } from '../lib/api';
  import type { EntityDataset } from '../lib/types';
  import ConfirmDialog from './ConfirmDialog.svelte';

  const {
    entityKey,
    displayName,
    description: initialDescription = null,
    logoUrl: initialLogoUrl = null,
    externalUrl: initialExternalUrl = null,
    onEnrichmentSaved,
    onDeleted,
  }: {
    entityKey: string;
    displayName: string;
    description?: string | null;
    logoUrl?: string | null;
    externalUrl?: string | null;
    onEnrichmentSaved: () => void;
    onDeleted: () => void;
  } = $props();

  let datasets = $state<EntityDataset[]>([]);
  let loading = $state(true);
  let collapsed = $state(new Set<string>());

  // Edit form state
  let editing = $state(false);
  let editName = $state(displayName);
  let editDesc = $state(initialDescription ?? '');
  let editLogo = $state(initialLogoUrl ?? '');
  let editUrl = $state(initialExternalUrl ?? '');
  let saving = $state(false);

  let deleteOpen = $state(false);

  $effect(() => {
    // Re-run when entityKey changes
    const key = entityKey;
    loading = true;
    datasets = [];
    getEntityRecords(key).then(res => {
      datasets = res.datasets;
      loading = false;
    });
  });

  // Sync edit fields when props change (different entity selected)
  $effect(() => {
    editName = displayName;
    editDesc = initialDescription ?? '';
    editLogo = initialLogoUrl ?? '';
    editUrl = initialExternalUrl ?? '';
    editing = false;
  });

  function toggleCollapse(dataset: string) {
    const next = new Set(collapsed);
    if (next.has(dataset)) next.delete(dataset); else next.add(dataset);
    collapsed = next;
  }

  async function handleSave() {
    saving = true;
    await saveEntity(entityKey, {
      display_name: editName.trim() || displayName,
      description: editDesc.trim() || undefined,
      logo_url: editLogo.trim() || undefined,
      external_url: editUrl.trim() || undefined,
    });
    saving = false;
    editing = false;
    onEnrichmentSaved();
  }

  async function handleDelete() {
    await deleteEntity(entityKey);
    onDeleted();
  }

  // Get visible field headers for a dataset (exclude internal fields)
  function getHeaders(records: Record<string, string>[]): string[] {
    if (records.length === 0) return [];
    return Object.keys(records[0]).filter(k => !k.startsWith('_'));
  }
</script>

<div class="en-detail">
  <!-- Header -->
  <div class="en-detail-header">
    <div class="en-detail-identity">
      {#if (editing ? editLogo : initialLogoUrl)}
        <img class="en-detail-logo" src={editing ? editLogo : (initialLogoUrl ?? '')} alt="" />
      {/if}
      <div>
        <div class="en-detail-name">{editing ? (editName || displayName) : displayName}</div>
        {#if !editing && initialDescription}
          <div class="en-detail-desc">{initialDescription}</div>
        {/if}
        {#if !editing && initialExternalUrl}
          <a class="en-detail-extlink" href={initialExternalUrl} target="_blank" rel="noopener">↗ {initialExternalUrl}</a>
        {/if}
      </div>
    </div>
    <div class="en-detail-actions">
      {#if !editing}
        <button class="en-btn" onclick={() => { editing = true; }}>Edit</button>
        <button class="en-btn en-btn--del" onclick={() => { deleteOpen = true; }}>Remove enrichment</button>
      {:else}
        <button class="en-btn en-btn--primary" onclick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button class="en-btn" onclick={() => { editing = false; }}>Cancel</button>
      {/if}
    </div>
  </div>

  <!-- Edit form -->
  {#if editing}
    <div class="en-edit-form">
      <div class="en-edit-row">
        <div class="en-edit-field">
          <label class="en-edit-label" for="en-edit-name">Display name</label>
          <input id="en-edit-name" class="en-edit-input" bind:value={editName} placeholder={displayName} />
        </div>
        <div class="en-edit-field">
          <label class="en-edit-label" for="en-edit-logo">Logo URL</label>
          <input id="en-edit-logo" class="en-edit-input" bind:value={editLogo} placeholder="https://…" />
        </div>
        <div class="en-edit-field">
          <label class="en-edit-label" for="en-edit-url">External URL</label>
          <input id="en-edit-url" class="en-edit-input" bind:value={editUrl} placeholder="https://…" />
        </div>
      </div>
      <div class="en-edit-field">
        <label class="en-edit-label" for="en-edit-desc">Description</label>
        <textarea id="en-edit-desc" class="en-edit-textarea" bind:value={editDesc} rows="2" placeholder="Brief description…"></textarea>
      </div>
    </div>
  {/if}

  <!-- Records by dataset -->
  <div class="en-datasets">
    {#if loading}
      <div class="en-loading">Loading…</div>
    {:else if datasets.length === 0}
      <div class="en-empty">No records found for this entity.</div>
    {:else}
      {#each datasets as ds (ds.dataset)}
        {@const headers = getHeaders(ds.records)}
        {@const isCollapsed = collapsed.has(ds.dataset)}
        <div class="en-ds-section">
          <button class="en-ds-toggle" onclick={() => toggleCollapse(ds.dataset)}>
            <span class="en-ds-arrow">{isCollapsed ? '▶' : '▼'}</span>
            <span class="en-ds-name">{ds.dataset}</span>
            <span class="en-ds-count">{ds.records.length} {ds.records.length === 1 ? 'record' : 'records'}</span>
          </button>
          {#if !isCollapsed}
            <div class="en-ds-table-wrap">
              <table class="en-table">
                <thead>
                  <tr>
                    {#each headers as h}
                      <th class="en-th">{h}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each ds.records as row}
                    <tr class="en-tr">
                      {#each headers as h}
                        <td class="en-td" title={row[h] ?? ''}>{row[h] ?? ''}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Remove enrichment?"
  description="This removes the saved description, logo, and URL. The entity itself still exists as long as records reference it."
  confirmLabel="Remove"
  danger
  onconfirm={handleDelete}
/>

<style>
  .en-detail {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 14px;
    overflow: hidden;
    font-family: 'DM Sans', sans-serif;
  }

  /* Header */
  .en-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem 1.5rem 1rem;
    border-bottom: 1px solid #ece9e3;
    flex-shrink: 0;
  }
  .en-detail-identity {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    min-width: 0;
  }
  .en-detail-logo {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    object-fit: contain;
    background: #f5f3ee;
    flex-shrink: 0;
  }
  .en-detail-name {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 1.15rem;
    color: #0e0d0b;
    letter-spacing: -0.02em;
  }
  .en-detail-desc {
    font-size: 0.82rem;
    color: #6b6860;
    margin-top: 0.2rem;
    line-height: 1.5;
  }
  .en-detail-extlink {
    display: inline-block;
    font-size: 0.75rem;
    color: #0e7490;
    margin-top: 0.25rem;
    text-decoration: none;
    word-break: break-all;
  }
  .en-detail-extlink:hover { text-decoration: underline; }

  .en-detail-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
    align-items: center;
  }

  .en-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    padding: 0.35rem 0.85rem;
    border-radius: 7px;
    border: 1.5px solid #dddbd5;
    background: #fff;
    color: #0e0d0b;
    transition: border-color 0.12s, background 0.12s;
  }
  .en-btn:hover { border-color: #aaa; background: #f5f3ee; }
  .en-btn:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .en-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .en-btn--primary { background: #0e7490; border-color: #0e7490; color: #fff; }
  .en-btn--primary:hover { background: #0c6078; border-color: #0c6078; }
  .en-btn--del { color: #6b6860; font-weight: 400; }

  /* Edit form */
  .en-edit-form {
    padding: 1rem 1.5rem;
    background: #faf9f6;
    border-bottom: 1px solid #ece9e3;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    flex-shrink: 0;
  }
  .en-edit-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .en-edit-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 160px;
  }
  .en-edit-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: #6b6860;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .en-edit-input, .en-edit-textarea {
    all: unset;
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 6px;
    padding: 0.4rem 0.65rem;
    font-size: 0.82rem;
    color: #0e0d0b;
    font-family: 'DM Sans', sans-serif;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .en-edit-input:focus, .en-edit-textarea:focus { border-color: #22d3ee; outline: none; }
  .en-edit-input::placeholder, .en-edit-textarea::placeholder { color: #b8b6b0; }
  .en-edit-textarea { resize: vertical; min-height: 2.5rem; }

  /* Datasets */
  .en-datasets {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .en-loading, .en-empty {
    font-size: 0.85rem;
    color: #9b9892;
    padding: 2rem 0;
    text-align: center;
  }

  .en-ds-section {
    border: 1px solid #e8e6e0;
    border-radius: 10px;
    overflow: hidden;
  }

  .en-ds-toggle {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.65rem 1rem;
    background: #faf9f6;
    border-bottom: 1px solid transparent;
    transition: background 0.1s;
  }
  .en-ds-toggle:hover { background: #f5f3ee; }
  .en-ds-section:has(.en-ds-table-wrap) .en-ds-toggle { border-bottom-color: #e8e6e0; }

  .en-ds-arrow { font-size: 0.6rem; color: #9b9892; flex-shrink: 0; }
  .en-ds-name {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 0.75rem;
    color: #0e0d0b;
    letter-spacing: -0.01em;
  }
  .en-ds-count {
    margin-left: auto;
    font-size: 0.72rem;
    color: #9b9892;
    font-family: 'IBM Plex Mono', monospace;
  }

  /* Table */
  .en-ds-table-wrap {
    overflow-x: auto;
  }
  .en-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }
  .en-th {
    padding: 0.4rem 0.75rem;
    background: #faf9f6;
    text-align: left;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #6b6860;
    border-bottom: 1px solid #e8e6e0;
    white-space: nowrap;
  }
  .en-tr:not(:last-child) td { border-bottom: 1px solid #f0ede8; }
  .en-tr:hover { background: #faf9f6; }
  .en-td {
    padding: 0.45rem 0.75rem;
    color: #0e0d0b;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
