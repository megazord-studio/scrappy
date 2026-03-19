<script lang="ts">
  import { getRecords, mergeRows, markNotDuplicate } from '../lib/api';
  import { buildDupGroups, groupMaxScore, dupScaleHtml } from '../lib/dedup';

  const { file, refreshTick }: { file: string | null; refreshTick: number } = $props();

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
          mergeBtnColor = rowScore >= 1 ? '#4caf50' : rowScore >= 0.75 ? '#ffb74d' : '#888';
          mergeBtnBg = rowScore >= 1 ? '#1a2a1a' : rowScore >= 0.75 ? '#2a1f0a' : '#1a1a1a';
          mergeBtnBorder = rowScore >= 1 ? '#2a4a2a' : rowScore >= 0.75 ? '#4a3a0a' : '#333';
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
    <a class="dl-link" href="/outputs/{file}" style="margin-left:auto">↓ csv</a>
  </div>
  <div class="records-scroll records-wrap">
    <table class="records-table">
      <thead>
        <tr>
          {#each headers as h}
            <th class={cellClass(h)}>{h.startsWith('_') ? h.slice(1) : h}</th>
          {/each}
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
    margin-bottom: 0.5rem;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.7rem;
  }
  .records-meta-count { color: #d0d0d0; font-weight: 600; }
  .records-meta-label { color: #666; font-weight: 400; }
  .records-meta-file {
    color: #555;
    padding-left: 0.4rem;
    border-left: 1px solid #2a2a2a;
  }
  .records-meta-dup { color: #f59e0b; }

  /* Duplicate group header row */
  .dup-group-header td {
    padding: 0.4rem 0.55rem 0.35rem !important;
    background: color-mix(in srgb, var(--group-color) 6%, #0d0d0d) !important;
    border-top: 1px solid color-mix(in srgb, var(--group-color) 20%, transparent);
    border-bottom: none !important;
  }
  .dup-header-inner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-family: "IBM Plex Mono", monospace;
  }
  .dup-conf-badge {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.1rem 0.35rem;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .dup-conf-badge.exact   { background: #0d2a0d; color: #4caf50; border: 1px solid #1a4a1a; }
  .dup-conf-badge.likely  { background: #2a1e08; color: #f59e0b; border: 1px solid #4a350a; }
  .dup-conf-badge.possible { background: #1a1a1a; color: #888; border: 1px solid #333; }

  .dup-group-desc {
    font-size: 0.65rem;
    color: #666;
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
    font-size: 0.65rem;
    font-family: "IBM Plex Mono", monospace;
    padding: 0.2rem 0.55rem;
    border-radius: 2px;
    border: 1px solid;
    line-height: 1.4;
    transition: opacity 0.15s;
  }
  .dup-action-btn:hover { opacity: 0.8; }
  .dup-action-btn.merge.exact   { color: #4caf50; background: #0d2a0d; border-color: #2a5a2a; }
  .dup-action-btn.merge.likely  { color: #f59e0b; background: #2a1e08; border-color: #5a3a08; }
  .dup-action-btn.merge.possible { color: #aaa; background: #1a1a1a; border-color: #3a3a3a; }
  .dup-action-btn.dismiss { color: #666; background: #111; border-color: #272727; }
  .dup-action-btn.dismiss:hover { color: #aaa; opacity: 1; border-color: #444; }

  /* Row group coloring */
  .data-row.in-group td {
    background: color-mix(in srgb, var(--group-color) 3%, transparent);
  }
  .data-row.in-group td:first-child {
    box-shadow: inset 2px 0 0 var(--group-color);
  }

  /* Source badge */
  .source-badge {
    display: inline-block;
    padding: 0.08rem 0.3rem;
    border-radius: 2px;
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .source-badge.official   { background: #0a2018; color: #34d399; }
  .source-badge.comparison { background: #1e1508; color: #f59e0b; }
</style>
