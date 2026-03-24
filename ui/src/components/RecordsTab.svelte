<script lang="ts">
  import { getRecords, mergeRows, markNotDuplicate, deleteRecords, startUpdateJob } from '../lib/api';
  import { buildDupGroups, groupMaxScore, dupScaleHtml } from '../lib/dedup';

  const {
    file,
    refreshTick,
    schemaId = null,
  }: {
    file: string | null;
    refreshTick: number;
    schemaId?: string | null;
  } = $props();

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

  function cellClass(h: string): string {
    if (h === '_dataSource') return 'col-source';
    if (h.startsWith('_')) return 'col-system';
    if (/url/i.test(h)) return 'col-url';
    if (/zins|rate|rendite|ter|preis|ertrag/i.test(h)) return 'col-rate';
    return 'col-data';
  }

  const GROUP_BORDER_COLORS = ['#ffb74d', '#4fc3f7', '#81c784', '#f06292', '#ce93d8'];

  async function loadRecords() {
    if (!file) return;
    loading = true;
    error = null;
    try {
      const data = await getRecords(file);
      headers = data.headers;
      const rows = data.rows as Record<string, unknown>[];
      rowCount = rows.length;

      if (!headers.length) {
        displayRows = [];
        return;
      }

      const systemFields = ['_dataSource', '_lastUpdated', 'url'];
      const keyFields = ['kontoName', 'bankName'].filter(f => headers.includes(f));
      const useKeyFields = keyFields.length ? keyFields : headers.filter(h => !systemFields.includes(h));
      const rateFields = headers.filter(h => /zins|rate|rendite/i.test(h));

      const groups = buildDupGroups(rows as Record<string, unknown>[], useKeyFields, rateFields);

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
          ? groupMaxScore(origIdx, groupIndices!, rows as Record<string, unknown>[], useKeyFields, rateFields)
          : 0;

        // all rows in a group share the same allGroupIds for optimistic dismissal
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
          origIdx,
          row,
          gid,
          rowScore,
          borderColor,
          mergeKeepId,
          mergeRemoveIds,
          allGroupIds,
          mergeConfidence,
          mergeBtnColor,
          mergeBtnBg,
          mergeBtnBorder,
          isFirstOfGroup,
          groupSize: isFirstOfGroup ? groupIndices!.length : 0,
        });
      }

      displayRows = built;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function handleDeleteRecord(id: number) {
    if (!file) return;
    if (!confirm('Delete this record?')) return;
    try {
      await deleteRecords(file, [id]);
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
      const res = await mergeRows(file, keepId, removeIds);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Merge failed: ' + ((err as { error?: string }).error || res.status));
        return;
      }
      await loadRecords();
    } catch (e) {
      alert('Merge error: ' + (e as Error).message);
    }
  }

  // Set of "id1,id2,..." keys for groups the user dismissed (optimistic)
  let dismissedGroups = $state(new Set<string>());
  let openMenuIdx = $state<number | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);

  function toggleMenu(idx: number, e: MouseEvent) {
    e.stopPropagation();
    if (openMenuIdx === idx) { openMenuIdx = null; return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menuX = rect.right;
    menuY = rect.bottom + 4;
    openMenuIdx = idx;
  }

  $effect(() => {
    function closeMenu() { openMenuIdx = null; }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  });

  async function handleNotDuplicate(ids: number[]) {
    if (!file) return;
    const validIds = ids.filter(id => Number.isFinite(id));
    if (validIds.length < 2) return;
    const key = [...validIds].sort((a, b) => a - b).join(',');
    // Optimistic: hide the group immediately
    dismissedGroups.add(key);
    try {
      const res = await markNotDuplicate(file, validIds);
      if (res && !res.ok) {
        // revert optimistic update if server rejected
        dismissedGroups.delete(key);
        return;
      }
      await loadRecords();
      dismissedGroups.delete(key);
    } catch(e) {
      dismissedGroups.delete(key);
      console.error('[not-dup] error:', e);
    }
  }

  $effect(() => {
    // depend on refreshTick to trigger reload
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
  <div class="records-meta">
    <span class="records-meta-count">{rowCount}<span class="records-meta-label"> records</span></span>
    <span class="records-meta-file">{file}</span>
    {#if dupGroupCount > 0}
      <span class="records-meta-dup">{dupGroupCount} dup{dupGroupCount > 1 ? 's' : ''} · {dupTotalRows} rows</span>
    {/if}
  </div>
  {#if openMenuIdx !== null}
    {@const openRow = displayRows.find(dr => dr.origIdx === openMenuIdx)}
    {#if openRow}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="row-dropdown" style="top:{menuY}px;left:{menuX}px" onclick={(e) => e.stopPropagation()}>
        {#if schemaId}
          <button class="row-menu-item" onclick={() => { handleUpdateRecord(openRow.row, openRow.origIdx); openMenuIdx = null; }}>↻ Re-scrape</button>
          <button class="row-menu-item" onclick={() => { handleUpdateRecord(openRow.row, openRow.origIdx, true); openMenuIdx = null; }}>⌕ Deep search</button>
        {/if}
        <button class="row-menu-item row-menu-item--del" onclick={() => { handleDeleteRecord(Number(openRow.row['_id'])); openMenuIdx = null; }}>✕ Delete</button>
      </div>
    {/if}
  {/if}

  <div class="records-scroll records-wrap">
    <table class="records-table">
      <thead>
        <tr>
          {#each headers as h}
            <th class={cellClass(h)}>{h.startsWith('_') ? h.slice(1) : h}</th>
          {/each}
          <th class="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each displayRows.filter(dr => {
          if (!dr.allGroupIds.length) return true;
          const key = [...dr.allGroupIds].sort((a, b) => a - b).join(',');
          return !dismissedGroups.has(key);
        }) as dr (dr.origIdx)}
          {#if dr.isFirstOfGroup && dr.mergeKeepId !== null}
            <tr class="dup-group-header" style="--group-color:{dr.borderColor}">
              <td colspan={headers.length}>
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
              <td colspan={headers.length + 1}>{updateFeedback.msg}</td>
            </tr>
          {/if}
          <tr class="data-row" style={dr.borderColor ? `--group-color:${dr.borderColor}` : ''} class:in-group={!!dr.borderColor}>
            {#each headers as h}
              {#if h === '_dataSource'}
                <td class="col-source">
                  {#if dr.row[h]}
                    <span class="source-badge {dr.row[h]}">{dr.row[h]}</span>
                  {/if}
                </td>
              {:else}
                <td class={cellClass(h)} title={dr.row[h] ?? ''}>{dr.row[h] ?? ''}</td>
              {/if}
            {/each}
            <td class="col-actions">
              <button class="row-burger" onclick={(e) => toggleMenu(dr.origIdx, e)} aria-label="Row actions">
                <span></span><span></span><span></span>
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
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
  }
  .records-meta-count { color: #0e0d0b; font-weight: 600; }
  .records-meta-label { color: #6b6860; font-weight: 400; }
  .records-meta-file {
    color: #6b6860;
    padding-left: 0.4rem;
    border-left: 1px solid #e8e6e0;
  }
  .records-meta-dup { color: #d97706; }

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
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.1rem 0.35rem;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .dup-conf-badge.exact   { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .dup-conf-badge.likely  { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
  .dup-conf-badge.possible { background: #f5f3ee; color: #9b9892; border: 1px solid #e8e6e0; }

  .dup-group-desc {
    font-size: 0.72rem;
    color: #9b9892;
    flex-shrink: 0;
  }
  .dup-score-inline {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .dup-header-actions {
    display: flex;
    gap: 0.4rem;
    margin-left: auto;
    flex-shrink: 0;
  }
  .dup-action-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    padding: 0.2rem 0.55rem;
    border-radius: 2px;
    border: 1px solid;
    line-height: 1.4;
    transition: opacity 0.15s;
  }
  .dup-action-btn:hover { opacity: 0.8; }
  .dup-action-btn.merge.exact   { color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
  .dup-action-btn.merge.likely  { color: #d97706; background: #fffbeb; border-color: #fde68a; }
  .dup-action-btn.merge.possible { color: #6b6860; background: #f5f3ee; border-color: #e8e6e0; }
  .dup-action-btn.dismiss { color: #9b9892; background: #f5f3ee; border-color: #e8e6e0; }
  .dup-action-btn.dismiss:hover { color: #0e0d0b; opacity: 1; border-color: #d0cec8; }

  /* Row group coloring */
  .data-row.in-group td {
    background: color-mix(in srgb, var(--group-color) 5%, #fff);
  }
  .data-row.in-group td:first-child {
    box-shadow: inset 2px 0 0 var(--group-color);
  }

  /* Update feedback row */
  .update-feedback-row td {
    background: #f0fdf4 !important;
    color: #15803d;
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    padding: 0.3rem 0.75rem !important;
    border-bottom: 1px solid #bbf7d0 !important;
  }

  /* Row burger menu */
  .col-actions {
    width: 36px;
    white-space: nowrap;
    padding: 0 0.35rem !important;
    text-align: center;
  }
  .row-burger {
    all: unset;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0.3rem 0.4rem;
    border-radius: 4px;
    border: 1px solid #e8e6e0;
    background: #fff;
    transition: background 0.12s, border-color 0.12s;
  }
  .row-burger:hover { background: #f5f3ee; border-color: #ccc; }
  .row-burger span {
    display: block;
    width: 12px;
    height: 1.5px;
    background: #6b6860;
    border-radius: 1px;
  }
  .row-dropdown {
    position: fixed;
    transform: translateX(-100%);
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 7px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.10);
    z-index: 100;
    min-width: 130px;
    overflow: hidden;
  }
  .row-menu-item {
    all: unset;
    cursor: pointer;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.85rem;
    font-size: 0.8rem;
    font-family: "IBM Plex Mono", monospace;
    color: #0e0d0b;
    transition: background 0.1s;
  }
  .row-menu-item:hover { background: #f5f3ee; }
  .row-menu-item--del { color: #dc2626; }
  .row-menu-item--del:hover { background: #fef2f2; }

  /* Source badge */
  .source-badge {
    display: inline-block;
    padding: 0.08rem 0.3rem;
    border-radius: 2px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .source-badge.official   { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .source-badge.comparison { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
</style>
