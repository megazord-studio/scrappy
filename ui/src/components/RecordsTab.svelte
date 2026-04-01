<script lang="ts">
  import { getRecords, mergeRows, markNotDuplicate, deleteRecords, startUpdateJob, getSchema } from '../lib/api';
  import { buildDupGroups, groupMaxScore, dupScaleHtml } from '../lib/dedup';
  import { DropdownMenu, Tooltip, Checkbox } from 'bits-ui';
  import ConfirmDialog from './ConfirmDialog.svelte';

  const {
    file,
    refreshTick,
    schemaId = null,
    onNavigateEntity = null,
  }: {
    file: string | null;
    refreshTick: number;
    schemaId?: string | null;
    onNavigateEntity?: ((key: string) => void) | null;
  } = $props();

  // Entity field for this schema — used to make entity column cells clickable
  let entityField = $state<string | null>(null);
  $effect(() => {
    const id = schemaId;
    if (!id) { entityField = null; return; }
    getSchema(id).then(s => { entityField = s.entity_field ?? null; }).catch(() => { entityField = null; });
  });

  interface DisplayRow {
    origIdx: number;
    row: Record<string, string>;
    gid: number | null;
    rowScore: number;
    borderColor: string | null;
    mergeKeepId: number | null;
    mergeRemoveIds: number[];
    allGroupIds: number[];
    mergeConfidence: string;
    mergeBtnColor: string;
    mergeBtnBg: string;
    mergeBtnBorder: string;
    isFirstOfGroup: boolean;
    groupSize: number;
  }

  let headers = $state<string[]>([]);
  let displayRows = $state<DisplayRow[]>([]);
  let rowCount = $state(0);
  let dupGroupCount = $state(0);
  let dupTotalRows = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // ── Selection ──────────────────────────────────────────────────────────────
  let selectedIds = $state(new Set<number>());
  let bulkDeleteOpen = $state(false);

  // Set of "id1,id2,..." keys for groups the user dismissed (optimistic)
  let dismissedGroups = $state(new Set<string>());

  const visibleRows = $derived(
    displayRows.filter(dr => {
      if (!dr.allGroupIds.length) return true;
      const key = [...dr.allGroupIds].sort((a, b) => a - b).join(',');
      return !dismissedGroups.has(key);
    })
  );

  const allDisplayedIds = $derived(
    visibleRows.map(dr => Number(dr.row['_id'])).filter(id => Number.isFinite(id))
  );
  const allSelected = $derived(
    allDisplayedIds.length > 0 && allDisplayedIds.every(id => selectedIds.has(id))
  );
  const someSelected = $derived(allDisplayedIds.some(id => selectedIds.has(id)));
  const headerChecked = $derived(allSelected);
  const headerIndeterminate = $derived(someSelected && !allSelected);

  function toggleRow(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function toggleAll() {
    selectedIds = allSelected ? new Set() : new Set(allDisplayedIds);
  }

  async function bulkDelete() {
    if (!file || selectedIds.size === 0) return;
    try {
      await deleteRecords(file, [...selectedIds]);
      selectedIds = new Set();
      await loadRecords();
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    }
  }

  // ── Entity navigation ──────────────────────────────────────────────────────
  function normalizeForEntity(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\b(ag|sa|gmbh|ltd|inc|co\.?|llc|corp|plc|sas|nv|bv|ug|kg|oy|ab|as|aps|spa|srl)\b\.?/gi, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Column helpers ─────────────────────────────────────────────────────────
  function cellClass(h: string): string {
    if (h === '_dataSource') return 'col-source';
    if (h.startsWith('_')) return 'col-system';
    if (/url/i.test(h)) return 'col-url';
    if (/zins|rate|rendite|ter|preis|ertrag/i.test(h)) return 'col-rate';
    return 'col-data';
  }

  function needsTooltip(h: string, value: string): boolean {
    if (h === '_dataSource' || !value) return false;
    if (/url/i.test(h)) return true;
    return value.length > 40;
  }

  const GROUP_BORDER_COLORS = ['#ffb74d', '#4fc3f7', '#81c784', '#f06292', '#ce93d8'];

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadRecords() {
    if (!file) return;
    loading = true;
    error = null;
    try {
      const data = await getRecords(file);
      headers = data.headers;
      const rows = data.rows as Record<string, unknown>[];
      rowCount = rows.length;

      if (!headers.length) { displayRows = []; return; }

      const systemFields = ['_dataSource', '_lastUpdated', 'url'];
      const keyFields = ['kontoName', 'bankName'].filter(f => headers.includes(f));
      const useKeyFields = keyFields.length ? keyFields : headers.filter(h => !systemFields.includes(h));
      const trackedFields = headers.filter(h => /zins|rate|rendite/i.test(h));

      const groups = buildDupGroups(rows as Record<string, unknown>[], useKeyFields, trackedFields);
      const dupGroupsList = [...groups.values()].filter(g => g.length > 1);
      const singletons = [...groups.values()].filter(g => g.length === 1).map(g => g[0]);
      const displayOrder = [...dupGroupsList.flat(), ...singletons];
      const rowGroupId = new Map<number, number>();
      dupGroupsList.forEach((g, gi) => g.forEach(i => rowGroupId.set(i, gi)));

      dupGroupCount = dupGroupsList.length;
      dupTotalRows = dupGroupsList.reduce((s, g) => s + g.length, 0);

      let prevGroupId = -2;
      const built: DisplayRow[] = [];

      for (const origIdx of displayOrder) {
        const row = rows[origIdx] as Record<string, string>;
        const gid = rowGroupId.has(origIdx) ? rowGroupId.get(origIdx)! : null;
        const isInGroup = gid !== null;
        const groupIndices = isInGroup ? dupGroupsList[gid] : null;
        const borderColor = isInGroup ? GROUP_BORDER_COLORS[gid % GROUP_BORDER_COLORS.length] : null;
        const rowScore = isInGroup
          ? groupMaxScore(origIdx, groupIndices!, rows as Record<string, unknown>[], useKeyFields, trackedFields)
          : 0;
        const allGroupIds: number[] = isInGroup
          ? groupIndices!.map(i => Number((rows[i] as Record<string, string>)['_id']))
          : [];

        let mergeKeepId: number | null = null;
        let mergeRemoveIds: number[] = [];
        let mergeConfidence = '';
        let mergeBtnColor = '';
        let mergeBtnBg = '';
        let mergeBtnBorder = '';
        let isFirstOfGroup = false;

        if (isInGroup && prevGroupId !== gid) {
          isFirstOfGroup = true;
          const winnerIdx = groupIndices!.find(i => (rows[i] as Record<string, string>)['_dataSource'] === 'official') ?? groupIndices![0];
          const removeIdxs = groupIndices!.filter(i => i !== winnerIdx);
          mergeKeepId = Number((rows[winnerIdx] as Record<string, string>)['_id']);
          mergeRemoveIds = removeIdxs.map(i => Number((rows[i] as Record<string, string>)['_id']));
          mergeConfidence = rowScore >= 1 ? 'exact' : rowScore >= 0.75 ? 'likely' : 'possible';
          mergeBtnColor = rowScore >= 1 ? '#16a34a' : rowScore >= 0.75 ? '#d97706' : '#6b6860';
          mergeBtnBg = rowScore >= 1 ? '#f0fdf4' : rowScore >= 0.75 ? '#fffbeb' : '#f5f3ee';
          mergeBtnBorder = rowScore >= 1 ? '#bbf7d0' : rowScore >= 0.75 ? '#fde68a' : '#e8e6e0';
        }

        prevGroupId = gid ?? -2;
        built.push({
          origIdx, row, gid, rowScore, borderColor, mergeKeepId, mergeRemoveIds,
          allGroupIds, mergeConfidence, mergeBtnColor, mergeBtnBg, mergeBtnBorder,
          isFirstOfGroup, groupSize: isFirstOfGroup ? groupIndices!.length : 0,
        });
      }

      displayRows = built;
      selectedIds = new Set();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  // ── Row actions ────────────────────────────────────────────────────────────
  let deleteConfirmOpen = $state(false);
  let deleteConfirmId = $state<number | null>(null);

  function handleDeleteRecord(id: number) {
    deleteConfirmId = id;
    deleteConfirmOpen = true;
  }

  async function confirmDeleteRecord() {
    if (!file || deleteConfirmId === null) return;
    try {
      await deleteRecords(file, [deleteConfirmId]);
      await loadRecords();
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    }
  }

  let updateFeedback = $state<{ origIdx: number; msg: string } | null>(null);

  async function handleUpdateRecord(row: Record<string, string>, origIdx: number, deepSearch = false) {
    if (!file || !schemaId) return;
    const recordId = Number(row['_id']);
    if (!Number.isFinite(recordId)) return;
    try {
      await startUpdateJob({ input: file, schema: schemaId, recordId, deepSearch: deepSearch || undefined });
      updateFeedback = { origIdx, msg: deepSearch ? 'Deep search started — check Monitor' : 'Update job started — check Monitor' };
      setTimeout(() => { updateFeedback = null; }, 4000);
    } catch (e) {
      alert('Update failed: ' + (e as Error).message);
    }
  }

  async function handleMerge(keepId: number, removeIds: number[]) {
    if (!file) return;
    try {
      await mergeRows(file, keepId, removeIds);
      await loadRecords();
    } catch (e) {
      alert('Merge failed: ' + (e as Error).message);
    }
  }

  async function handleNotDuplicate(ids: number[]) {
    if (!file) return;
    const validIds = ids.filter(id => Number.isFinite(id));
    if (validIds.length < 2) return;
    const key = [...validIds].sort((a, b) => a - b).join(',');
    dismissedGroups.add(key);
    try {
      await markNotDuplicate(file, validIds);
      await loadRecords();
      dismissedGroups.delete(key);
    } catch(e) {
      dismissedGroups.delete(key);
      console.error('[not-dup] error:', e);
    }
  }

  $effect(() => {
    void refreshTick;
    if (file) loadRecords();
  });
</script>

{#if loading && displayRows.length === 0}
  <div class="dash-empty" style="height:200px">Loading records…</div>
{:else if error}
  <div class="dash-empty" style="height:200px;color:#f44336">{error}</div>
{:else if !file || headers.length === 0}
  <div class="dash-empty" style="height:200px">No records yet</div>
{:else}
  <Tooltip.Provider delayDuration={350} skipDelayDuration={100}>
  <div class="records-root">

    <!-- Meta bar -->
    <div class="records-meta">
      <span class="records-meta-count">{rowCount}<span class="records-meta-label"> records</span></span>
      <span class="records-meta-file">{file}</span>
      {#if dupGroupCount > 0}
        <span class="records-meta-dup">{dupGroupCount} dup{dupGroupCount > 1 ? 's' : ''} · {dupTotalRows} rows</span>
      {/if}
    </div>

    <!-- Bulk action bar -->
    {#if selectedIds.size > 0}
      <div class="bulk-bar">
        <span class="bulk-count">{selectedIds.size} selected</span>
        <button class="bulk-btn bulk-btn--del" onclick={() => { bulkDeleteOpen = true; }}>
          Delete {selectedIds.size}
        </button>
        <button class="bulk-clear" onclick={() => { selectedIds = new Set(); }} aria-label="Clear selection">✕</button>
      </div>
    {/if}

    <!-- Table -->
    <div class="records-scroll">
        <table class="records-table">
          <thead>
            <tr>
              <th class="col-check">
                <Checkbox.Root
                  checked={headerChecked}
                  indeterminate={headerIndeterminate}
                  onCheckedChange={toggleAll}
                  class="cb-root"
                  aria-label="Select all"
                />
              </th>
              {#each headers as h}
                <th class={cellClass(h)}>{h.startsWith('_') ? h.slice(1) : h}</th>
              {/each}
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each visibleRows as dr (dr.origIdx)}
              {@const rowId = Number(dr.row['_id'])}

              {#if dr.isFirstOfGroup && dr.mergeKeepId !== null}
                <tr class="dup-group-header" style="--group-color:{dr.borderColor}">
                  <td colspan={headers.length + 2}>
                    <div class="dup-header-inner">
                      <span class="dup-conf-badge {dr.mergeConfidence}">{dr.mergeConfidence}</span>
                      <span class="dup-group-desc">{dr.groupSize} rows</span>
                      <span class="dup-score-inline">{@html dupScaleHtml(dr.rowScore)}</span>
                      <div class="dup-header-actions">
                        <button
                          class="dup-action-btn merge {dr.mergeConfidence}"
                          onclick={() => handleMerge(dr.mergeKeepId!, dr.mergeRemoveIds)}
                        >Merge → keep best</button>
                        <button
                          class="dup-action-btn dismiss"
                          onclick={() => handleNotDuplicate(dr.allGroupIds)}
                        >Keep separate</button>
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}

              {#if updateFeedback?.origIdx === dr.origIdx}
                <tr class="update-feedback-row">
                  <td colspan={headers.length + 2}>{updateFeedback.msg}</td>
                </tr>
              {/if}

              <tr
                class="data-row"
                style={dr.borderColor ? `--group-color:${dr.borderColor}` : ''}
                class:in-group={!!dr.borderColor}
                class:is-selected={selectedIds.has(rowId)}
              >
                <td class="col-check">
                  <Checkbox.Root
                    checked={selectedIds.has(rowId)}
                    onCheckedChange={() => toggleRow(rowId)}
                    class="cb-root"
                    aria-label="Select row"
                  />
                </td>

                {#each headers as h}
                  {@const value = dr.row[h] ?? ''}
                  {#if h === '_dataSource'}
                    <td class="col-source">
                      {#if value}
                        <span class="source-badge {value}">{value}</span>
                      {/if}
                    </td>
                  {:else if h === entityField && onNavigateEntity && value}
                    <td class={cellClass(h)}>
                      <button class="entity-link" onclick={() => onNavigateEntity!(normalizeForEntity(value))}>{value}</button>
                    </td>
                  {:else if needsTooltip(h, value)}
                    <td class={cellClass(h)}>
                      <Tooltip.Root>
                        <Tooltip.Trigger class="cell-tt">{value}</Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content class="cell-tooltip">
                            {value}
                            <Tooltip.Arrow class="cell-tooltip-arrow" />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    </td>
                  {:else}
                    <td class={cellClass(h)}>{value}</td>
                  {/if}
                {/each}

                <td class="col-actions">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger class="row-burger" aria-label="Row actions">
                      <span></span><span></span><span></span>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="row-dropdown" sideOffset={4} align="end">
                        {#if schemaId}
                          <DropdownMenu.Item class="row-menu-item" onclick={() => handleUpdateRecord(dr.row, dr.origIdx)}>↻ Re-scrape</DropdownMenu.Item>
                          <DropdownMenu.Item class="row-menu-item" onclick={() => handleUpdateRecord(dr.row, dr.origIdx, true)}>⌕ Deep search</DropdownMenu.Item>
                          <DropdownMenu.Separator class="row-menu-sep" />
                        {/if}
                        <DropdownMenu.Item class="row-menu-item row-menu-item--del" onclick={() => handleDeleteRecord(rowId)}>✕ Delete</DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
    </div>

  </div>
  </Tooltip.Provider>
{/if}

<ConfirmDialog
  bind:open={deleteConfirmOpen}
  title="Delete record?"
  description="This record will be permanently removed."
  confirmLabel="Delete"
  danger
  onconfirm={confirmDeleteRecord}
/>

<ConfirmDialog
  bind:open={bulkDeleteOpen}
  title="Delete {selectedIds.size} records?"
  description="These records will be permanently removed. This cannot be undone."
  confirmLabel="Delete all"
  danger
  onconfirm={bulkDelete}
/>

<style>
  .records-root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Meta bar */
  .records-meta {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: #faf9f6;
    border-bottom: 1px solid #e8e6e0;
    flex-shrink: 0;
  }
  .records-meta-count { color: #0e0d0b; font-weight: 600; }
  .records-meta-label { color: #6b6860; font-weight: 400; }
  .records-meta-file { color: #6b6860; padding-left: 0.4rem; border-left: 1px solid #e8e6e0; }
  .records-meta-dup { color: #d97706; }

  /* Bulk action bar */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.75rem;
    background: #ecfeff;
    border-bottom: 1px solid #67e8f9;
    font-family: "DM Sans", sans-serif;
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .bulk-count {
    font-weight: 600;
    color: #0e7490;
    margin-right: 0.2rem;
  }
  .bulk-btn {
    all: unset;
    cursor: pointer;
    padding: 0.25rem 0.75rem;
    border-radius: 5px;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: "DM Sans", sans-serif;
    border: 1.5px solid;
    transition: opacity 0.12s;
  }
  .bulk-btn:hover { opacity: 0.8; }
  .bulk-btn--del { color: #dc2626; border-color: #fca5a5; background: #fef2f2; }
  .bulk-clear {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    color: #6b6860;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    transition: color 0.12s;
  }
  .bulk-clear:hover { color: #0e0d0b; }

  /* Checkbox column */
  .col-check {
    width: 32px;
    padding: 0 0.4rem !important;
    text-align: center;
    flex-shrink: 0;
  }
  :global(.cb-root) {
    all: unset;
    width: 14px;
    height: 14px;
    border: 1.5px solid #d0cec8;
    border-radius: 3px;
    background: #fff;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, border-color 0.12s;
    flex-shrink: 0;
    position: relative;
  }
  :global(.cb-root:hover) { border-color: #22d3ee; }
  :global(.cb-root:focus-visible) { outline: 2px solid #22d3ee; outline-offset: 2px; }
  :global(.cb-root[data-state="checked"]) { background: #22d3ee; border-color: #22d3ee; }
  :global(.cb-root[data-state="indeterminate"]) { background: #22d3ee; border-color: #22d3ee; }
  :global(.cb-root[data-state="checked"])::after {
    content: '';
    width: 8px;
    height: 4px;
    border-left: 1.5px solid #fff;
    border-bottom: 1.5px solid #fff;
    transform: rotate(-45deg) translateY(-1px);
  }
  :global(.cb-root[data-state="indeterminate"])::after {
    content: '';
    width: 8px;
    height: 1.5px;
    background: #fff;
    border-radius: 1px;
  }

  /* Scroll container */
  .records-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  /* Cell tooltip */
  :global(.cell-tt) {
    all: unset;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    cursor: default;
  }
  :global(.cell-tt:focus-visible) { outline: 2px solid #22d3ee; border-radius: 2px; }
  :global(.cell-tooltip) {
    background: #0e0d0b;
    color: #f5f3ee;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.72rem;
    padding: 0.35rem 0.6rem;
    border-radius: 5px;
    max-width: 360px;
    word-break: break-all;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 300;
  }
  :global(.cell-tooltip-arrow) {
    fill: #0e0d0b;
  }

  /* Duplicate group header row */
  .dup-group-header td {
    padding: 0.4rem 0.55rem 0.35rem !important;
    background: color-mix(in srgb, var(--group-color) 8%, #fff) !important;
    border-top: 1px solid color-mix(in srgb, var(--group-color) 25%, transparent);
    border-bottom: none !important;
  }
  .dup-header-inner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-family: "IBM Plex Mono", monospace;
  }
  .dup-conf-badge {
    font-size: 0.65rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0.1rem 0.35rem; border-radius: 2px; flex-shrink: 0;
  }
  .dup-conf-badge.exact   { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .dup-conf-badge.likely  { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
  .dup-conf-badge.possible { background: #f5f3ee; color: #9b9892; border: 1px solid #e8e6e0; }
  .dup-group-desc { font-size: 0.72rem; color: #9b9892; flex-shrink: 0; }
  .dup-score-inline { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
  .dup-header-actions { display: flex; gap: 0.4rem; margin-left: auto; flex-shrink: 0; }
  .dup-action-btn {
    all: unset; cursor: pointer;
    font-size: 0.72rem; font-family: "IBM Plex Mono", monospace;
    padding: 0.2rem 0.55rem; border-radius: 2px;
    border: 1px solid; line-height: 1.4; transition: opacity 0.15s;
  }
  .dup-action-btn:hover { opacity: 0.8; }
  .dup-action-btn.merge.exact   { color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
  .dup-action-btn.merge.likely  { color: #d97706; background: #fffbeb; border-color: #fde68a; }
  .dup-action-btn.merge.possible { color: #6b6860; background: #f5f3ee; border-color: #e8e6e0; }
  .dup-action-btn.dismiss { color: #9b9892; background: #f5f3ee; border-color: #e8e6e0; }
  .dup-action-btn.dismiss:hover { color: #0e0d0b; opacity: 1; border-color: #d0cec8; }

  /* Row group coloring + selected state */
  .data-row.in-group td { background: color-mix(in srgb, var(--group-color) 5%, #fff); }
  .data-row.in-group td:first-child { box-shadow: inset 2px 0 0 var(--group-color); }
  .data-row.is-selected td { background: #f0fdff !important; }

  /* Update feedback row */
  .update-feedback-row td {
    background: #f0fdf4 !important; color: #15803d;
    font-size: 0.72rem; font-family: "IBM Plex Mono", monospace;
    padding: 0.3rem 0.75rem !important; border-bottom: 1px solid #bbf7d0 !important;
  }

  /* Row burger menu */
  .col-actions {
    width: 36px; white-space: nowrap;
    padding: 0 0.35rem !important; text-align: center;
  }
  :global(.row-burger) {
    all: unset; cursor: pointer;
    display: flex; flex-direction: column; gap: 3px;
    padding: 0.3rem 0.4rem; border-radius: 4px;
    border: 1px solid #e8e6e0; background: #fff;
    transition: background 0.12s, border-color 0.12s;
  }
  :global(.row-burger:hover) { background: #f5f3ee; border-color: #ccc; }
  :global(.row-burger span) {
    display: block; width: 12px; height: 1.5px;
    background: #6b6860; border-radius: 1px;
  }
  :global(.row-dropdown) {
    background: #fff; border: 1px solid #dddbd5; border-radius: 7px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.10); z-index: 100;
    min-width: 140px; overflow: hidden; padding: 0.25rem 0;
  }
  :global(.row-menu-item) {
    all: unset; cursor: pointer; display: block;
    width: 100%; box-sizing: border-box;
    padding: 0.5rem 0.85rem; font-size: 0.8rem;
    font-family: "IBM Plex Mono", monospace; color: #0e0d0b; transition: background 0.1s;
  }
  :global(.row-menu-item[data-highlighted]) { background: #f5f3ee; }
  :global(.row-menu-item--del) { color: #dc2626; }
  :global(.row-menu-item--del[data-highlighted]) { background: #fef2f2; }
  :global(.row-menu-sep) { height: 1px; background: #e8e6e0; margin: 0.2rem 0; }

  /* Entity link cell button */
  .entity-link {
    all: unset;
    cursor: pointer;
    color: #0e7490;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, #0e7490 40%, transparent);
    text-underline-offset: 2px;
    font-family: inherit;
    font-size: inherit;
    transition: color 0.1s;
  }
  .entity-link:hover { color: #0c6078; text-decoration-color: #0c6078; }
  .entity-link:focus-visible { outline: 2px solid #22d3ee; border-radius: 2px; }

  /* Source badge */
  .source-badge {
    display: inline-block; padding: 0.08rem 0.3rem; border-radius: 2px;
    font-size: 0.65rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  }
  .source-badge.official   { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .source-badge.comparison { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
</style>
