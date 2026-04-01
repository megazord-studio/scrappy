<script lang="ts">
  import { getSchema, getSchemas, deleteSchema, saveSchema, sendChat } from '../lib/api';
  import type { Schema, SchemaField } from '../lib/types';

  const {
    onNewSchema,
    onSelectsReload,
  }: {
    onNewSchema: () => void;
    onSelectsReload: () => void;
  } = $props();

  interface EditField {
    name: string;
    optional: boolean;
    description: string;
  }

  let schemas = $state<Schema[]>([]);
  let selectedId = $state<string | null>(null);
  let selectedFull = $state<Schema | null>(null);
  let loading = $state(true);
  let deleting = $state(false);
  let saving = $state(false);
  let saveError = $state('');
  let search = $state('');

  // Edit mode state
  let editMode = $state(false);
  let editDisplayName = $state('');
  let editUrlField = $state('');
  let editDedupeKey = $state('');
  let editTrackedFields = $state('');
  let editEntityField = $state('');
  let editNamingRules = $state('');
  let editFields = $state<EditField[]>([]);
  let advancedOpen = $state(false);

  const selected = $derived(selectedFull ?? schemas.find(s => s.id === selectedId) ?? null);

  // Load full schema data (with fields) whenever selection changes
  $effect(() => {
    const id = selectedId;
    if (!id) { selectedFull = null; return; }
    selectedFull = null;
    getSchema(id).then(row => { if (selectedId === id) selectedFull = row; });
  });

  const parsedFields = $derived((() => {
    if (!selected) return [] as SchemaField[];
    if (Array.isArray(selected.fields)) return selected.fields as SchemaField[];
    try { return JSON.parse(selected.fields as unknown as string) as SchemaField[]; } catch { return [] as SchemaField[]; }
  })());

  const filteredSchemas = $derived(
    search
      ? schemas.filter(s => s.display_name.toLowerCase().includes(search.toLowerCase()))
      : schemas
  );

  // Health metrics (read mode)
  const totalFields    = $derived(parsedFields.length);
  const requiredCount  = $derived(parsedFields.filter((f: SchemaField) => !f.optional).length);
  const describedCount = $derived(parsedFields.filter((f: SchemaField) => f.description && f.description.trim().length > 0).length);
  const structuralIntegrity = $derived(totalFields > 0 ? 100 : 0);
  const constraintDensity   = $derived(totalFields > 0 ? Math.round((requiredCount / totalFields) * 100) : 0);
  const descCoverage        = $derived(totalFields > 0 ? Math.round((describedCount / totalFields) * 100) : 0);

  async function load() {
    loading = true;
    try {
      const res = await getSchemas();
      schemas = res.schemas;
      if (!selectedId && res.schemas.length > 0) {
        selectedId = res.schemas[0].id;
      }
    } finally {
      loading = false;
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirm(`Delete schema "${selected.display_name}"?`)) return;
    deleting = true;
    try {
      await deleteSchema(selected.id);
      schemas = schemas.filter(s => s.id !== selected.id);
      selectedId = schemas.length > 0 ? schemas[0].id : null;
      onSelectsReload();
    } finally {
      deleting = false;
    }
  }

  async function enterEditMode() {
    if (!selected) return;
    const row = selectedFull ?? await getSchema(selected.id);
    editDisplayName = row.display_name;
    editUrlField = row.url_field ?? 'url';
    editDedupeKey = (() => { try { return (JSON.parse(row.dedupe_key as unknown as string) as string[]).join(', '); } catch { return row.dedupe_key ?? ''; } })();
    editTrackedFields = (() => { try { return (JSON.parse(row.tracked_fields as unknown as string) as string[]).join(', '); } catch { return ''; } })();
    editEntityField = row.entity_field ?? '';
    editNamingRules = (() => { try { const arr = JSON.parse(row.naming_rules as unknown as string) as string[]; return arr.join('\n'); } catch { return ''; } })();
    editFields = parsedFields.map(f => ({ name: f.name, optional: !!f.optional, description: f.description ?? '' }));
    saveError = '';
    advancedOpen = false;
    editMode = true;
  }

  function cancelEdit() {
    editMode = false;
    saveError = '';
  }

  async function handleSave() {
    if (!selected) return;
    const flds = editFields.filter(f => f.name.trim()).map(f => ({
      name: f.name.trim(),
      type: 'string',
      optional: f.optional,
      description: f.description.trim(),
    }));
    if (!editDisplayName.trim() || flds.length === 0 || !editUrlField.trim()) {
      saveError = 'Display name, at least one field, and URL field are required.';
      return;
    }
    const dk = editDedupeKey.split(',').map(s => s.trim()).filter(Boolean);
    const rf = editTrackedFields.split(',').map(s => s.trim()).filter(Boolean);
    const nr = editNamingRules.trim() ? editNamingRules.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const ef = editEntityField.trim() || undefined;
    saving = true;
    saveError = '';
    try {
      const res = await saveSchema({
        id: selected.id,
        display_name: editDisplayName.trim(),
        fields: flds,
        dedupe_key: dk,
        url_field: editUrlField.trim(),
        entity_field: ef,
        tracked_fields: rf,
        naming_rules: nr,
      }, selected.id) as { error?: string; ok?: boolean };
      if (res.ok === false) {
        saveError = res.error ?? 'Failed to save';
        return;
      }
      await load();
      onSelectsReload();
      editMode = false;
    } finally {
      saving = false;
    }
  }

  function addEditField() {
    editFields = [...editFields, { name: '', optional: false, description: '' }];
  }

  function removeEditField(i: number) {
    editFields = editFields.filter((_, idx) => idx !== i);
  }

  function updateEditField(i: number, key: keyof EditField, value: string | boolean) {
    editFields = editFields.map((f, idx) => idx === i ? { ...f, [key]: value } : f);
  }

  // Schema Optimizer chat
  interface OptimizerMsg { role: 'user' | 'assistant'; content: string; }
  let optimizerHistory = $state<OptimizerMsg[]>([]);
  let optimizerInput = $state('');
  let optimizerLoading = $state(false);
  let optimizerEl = $state<HTMLElement | null>(null);

  // Reset optimizer when schema changes
  $effect(() => {
    selectedId; // track
    optimizerHistory = [];
    optimizerInput = '';
  });

  async function sendOptimizer() {
    const msg = optimizerInput.trim();
    if (!msg || optimizerLoading) return;
    optimizerInput = '';
    optimizerHistory = [...optimizerHistory, { role: 'user', content: msg }];
    optimizerLoading = true;
    setTimeout(() => { if (optimizerEl) optimizerEl.scrollTop = optimizerEl.scrollHeight; }, 20);
    try {
      const context = selected
        ? `Schema: ${selected.display_name}. Fields: ${parsedFields.map(f => f.name + (f.optional ? '?' : '')).join(', ')}.`
        : '';
      const res = await sendChat(
        context ? `[Schema context: ${context}]\n${msg}` : msg,
        undefined,
        optimizerHistory.slice(0, -1)
      );
      if (!res.error) {
        optimizerHistory = [...optimizerHistory, { role: 'assistant', content: res.reply ?? '' }];
      }
    } finally {
      optimizerLoading = false;
      setTimeout(() => { if (optimizerEl) optimizerEl.scrollTop = optimizerEl.scrollHeight; }, 20);
    }
  }

  function handleOptimizerKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOptimizer(); }
  }

  function fieldTypeBadge(field: SchemaField) {
    const t = (field.type ?? 'string').toUpperCase();
    if (t.includes('INT') || t.includes('FLOAT') || t.includes('NUM')) return 'FLOAT';
    if (t.includes('BOOL')) return 'BOOL';
    if (t.includes('ENUM')) return 'ENUM';
    if (t.includes('URL') || t.includes('URI')) return 'URL';
    return 'STRING';
  }

  function healthColor(field: SchemaField, idx: number) {
    if (!field.optional) return `rgba(255,89,10,${0.4 + (idx % 3) * 0.2})`;
    return `rgba(255,89,10,${0.15 + (idx % 4) * 0.08})`;
  }

  load();
</script>

<div class="schemas-root">
  <!-- Left sidebar -->
  <aside class="schemas-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Schemas</span>
      <button class="new-schema-btn" onclick={onNewSchema}>
        <span class="msicon" style="font-size:14px">add</span>
      </button>
    </div>

    <div class="sidebar-search">
      <span class="msicon search-icon">search</span>
      <input class="search-input" placeholder="Search..." bind:value={search} />
    </div>

    <div class="schema-list">
      {#if loading}
        <div class="sidebar-empty">Loading...</div>
      {:else if filteredSchemas.length === 0}
        <div class="sidebar-empty">No schemas found</div>
      {:else}
        {#each filteredSchemas as s (s.id)}
          <button
            class="schema-item"
            class:active={s.id === selectedId}
            onclick={() => { selectedId = s.id; editMode = false; }}
          >
            <span class="msicon schema-icon">schema</span>
            <span class="schema-name">{s.display_name}</span>
          </button>
        {/each}
      {/if}
    </div>

    <div class="sidebar-bottom">
      <button class="new-full-btn" onclick={onNewSchema}>
        <span class="msicon" style="font-size:14px">add</span>
        New Schema
      </button>
    </div>
  </aside>

  <!-- Main content -->
  <main class="schemas-main">
    {#if !selected}
      <div class="no-selection">
        <span class="msicon" style="font-size:3rem;color:var(--on-surface-muted)">schema</span>
        <p>Select a schema to view its fields</p>
        <button class="new-full-btn" onclick={onNewSchema}>
          <span class="msicon" style="font-size:14px">add</span>
          Create New Schema
        </button>
      </div>
    {:else if editMode}
      <!-- ─── Edit mode ─── -->
      <div class="schema-header">
        <div class="schema-header-left">
          <div class="breadcrumb">
            <span class="crumb-dim">Schemas</span>
            <span class="crumb-sep">/</span>
            <span class="crumb-active">{selected.display_name}</span>
            <span class="crumb-sep">/</span>
            <span class="crumb-active">Edit</span>
          </div>
          <div class="edit-name-row">
            <input
              class="edit-title-input"
              type="text"
              bind:value={editDisplayName}
              placeholder="Schema display name"
            />
          </div>
        </div>
        <div class="schema-header-actions">
          <button class="action-btn" onclick={cancelEdit} disabled={saving}>
            <span class="msicon" style="font-size:16px">close</span>
            Cancel
          </button>
          <button class="action-btn primary" onclick={handleSave} disabled={saving}>
            <span class="msicon" style="font-size:16px">{saving ? 'hourglass_empty' : 'save'}</span>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {#if saveError}
        <div class="error-bar">{saveError}</div>
      {/if}

      <div class="content-grid">
        <div class="fields-col">
          <div class="section-head">
            <span class="section-label">Fields</span>
            <span class="section-hint">{editFields.filter(f => f.name.trim()).length} defined</span>
          </div>

          {#each editFields as f, i}
            <div class="edit-field-card">
              <div class="ef-top">
                <input
                  class="ef-name-input"
                  type="text"
                  placeholder="fieldName"
                  value={f.name}
                  oninput={(e) => updateEditField(i, 'name', (e.target as HTMLInputElement).value)}
                />
                <button
                  class="ef-opt-btn"
                  class:required={!f.optional}
                  onclick={() => updateEditField(i, 'optional', !f.optional)}
                  title="Toggle required / optional"
                >
                  {f.optional ? 'OPTIONAL' : 'REQUIRED'}
                </button>
                <button class="ef-remove" onclick={() => removeEditField(i)} title="Remove field">
                  <span class="msicon" style="font-size:14px">close</span>
                </button>
              </div>
              <input
                class="ef-desc-input"
                type="text"
                placeholder="Describe what to extract (guides the AI)"
                value={f.description}
                oninput={(e) => updateEditField(i, 'description', (e.target as HTMLInputElement).value)}
              />
            </div>
          {/each}

          <button class="append-btn" onclick={addEditField}>
            <span class="msicon">add</span>
            <span class="append-label">ADD_FIELD</span>
          </button>

          <!-- Advanced -->
          <button class="advanced-toggle" onclick={() => { advancedOpen = !advancedOpen; }}>
            <span class="msicon" style="font-size:14px">{advancedOpen ? 'expand_less' : 'expand_more'}</span>
            <span class="advanced-label">Advanced Settings</span>
            <span class="advanced-hint">{advancedOpen ? 'hide' : 'url, dedupe, tracking…'}</span>
          </button>

          {#if advancedOpen}
            <div class="advanced-panel">
              <div class="adv-row">
                <div class="adv-field">
                  <label class="adv-label">URL Field</label>
                  <input class="adv-input" type="text" bind:value={editUrlField} placeholder="url" />
                </div>
                <div class="adv-field">
                  <label class="adv-label">Dedupe Key <span class="adv-hint">comma-sep</span></label>
                  <input class="adv-input" type="text" bind:value={editDedupeKey} placeholder="bankName, kontoName" />
                </div>
                <div class="adv-field">
                  <label class="adv-label">Tracked Fields <span class="adv-hint">monitored for changes</span></label>
                  <input class="adv-input" type="text" bind:value={editTrackedFields} placeholder="zins, ter" />
                </div>
              </div>
              <div class="adv-row" style="margin-top: 0.75rem">
                <div class="adv-field">
                  <label class="adv-label">Entity Field <span class="adv-hint">links to cross-dataset entities</span></label>
                  <select class="adv-select" bind:value={editEntityField}>
                    <option value="">— none —</option>
                    {#each editFields.filter(f => f.name.trim()) as ef}
                      <option value={ef.name.trim()}>{ef.name.trim()}</option>
                    {/each}
                  </select>
                </div>
              </div>
              <div class="adv-field" style="margin-top: 0.75rem">
                <label class="adv-label">Naming Rules <span class="adv-hint">one per line — guides AI normalisation</span></label>
                <textarea
                  class="adv-textarea"
                  bind:value={editNamingRules}
                  rows="5"
                  placeholder="kontoName: use the exact plan name as shown on the website&#10;bankName: use the chain's official brand name"
                ></textarea>
              </div>
            </div>
          {/if}
        </div>

        <!-- Right panel: health map still visible in edit mode -->
        <div class="right-col">
          <div class="health-panel">
            <h3 class="panel-title">Schema Health Map</h3>
            <div class="health-grid">
              {#each editFields.filter(f => f.name.trim()) as f, i}
                <div
                  class="health-cell"
                  title="{f.name}: {f.optional ? 'optional' : 'required'}"
                  style="background: {f.optional ? `rgba(255,89,10,${0.15 + (i % 4) * 0.08})` : `rgba(255,89,10,${0.4 + (i % 3) * 0.2})`}"
                ></div>
              {/each}
              {#if editFields.filter(f => f.name.trim()).length === 0}
                {#each Array(12) as _}
                  <div class="health-cell" style="background: var(--surface-container-high)"></div>
                {/each}
              {/if}
            </div>
            <div class="health-bars">
              <div class="health-bar-row">
                <div class="bar-label">
                  <span>Fields Defined</span>
                  <span class="bar-val">{editFields.filter(f => f.name.trim()).length}</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: {Math.min(editFields.filter(f => f.name.trim()).length * 10, 100)}%"></div>
                </div>
              </div>
              <div class="health-bar-row">
                <div class="bar-label">
                  <span>Required</span>
                  <span class="bar-val">{editFields.filter(f => f.name.trim() && !f.optional).length}</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: {editFields.filter(f=>f.name.trim()).length > 0 ? Math.round((editFields.filter(f=>f.name.trim()&&!f.optional).length/editFields.filter(f=>f.name.trim()).length)*100) : 0}%"></div>
                </div>
              </div>
              <div class="health-bar-row">
                <div class="bar-label">
                  <span>Described</span>
                  <span class="bar-val">{editFields.filter(f => f.name.trim() && f.description.trim()).length}</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: {editFields.filter(f=>f.name.trim()).length > 0 ? Math.round((editFields.filter(f=>f.name.trim()&&f.description.trim()).length/editFields.filter(f=>f.name.trim()).length)*100) : 0}%"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    {:else}
      <!-- ─── View mode ─── -->
      <div class="schema-header">
        <div class="schema-header-left">
          <div class="breadcrumb">
            <span class="crumb-dim">Schemas</span>
            <span class="crumb-sep">/</span>
            <span class="crumb-active">{selected.display_name}</span>
          </div>
          <h1 class="schema-title">{selected.display_name}</h1>
        </div>
        <div class="schema-header-actions">
          <div class="schema-stats">
            <div class="stat-chip">
              <span class="stat-chip-val">{descCoverage}%</span>
              <span class="stat-chip-label">Coverage</span>
            </div>
            <div class="stat-chip" class:valid={totalFields > 0}>
              <span class="msicon" style="font-size:13px">{totalFields > 0 ? 'check_circle' : 'radio_button_unchecked'}</span>
              <span class="stat-chip-label">{totalFields > 0 ? 'Valid' : 'Empty'}</span>
            </div>
          </div>
          <button class="action-btn" onclick={enterEditMode}>
            <span class="msicon" style="font-size:16px">edit</span>
            Edit
          </button>
          <button class="action-btn danger" onclick={handleDelete} disabled={deleting}>
            <span class="msicon" style="font-size:16px">delete</span>
          </button>
        </div>
      </div>

      <div class="content-grid">
        <div class="fields-col">
          <div class="section-head">
            <span class="section-label">NODE_TOPOLOGY</span>
            <span class="section-hint">{totalFields} fields</span>
          </div>

          {#if parsedFields.length === 0}
            <div class="no-fields">No fields defined</div>
          {:else}
            {#each parsedFields as field (field.name)}
              <div class="field-card" class:required={!field.optional}>
                <div class="drag-indicator">
                  <span class="msicon" style="font-size:16px;color:var(--on-surface-muted)">drag_indicator</span>
                </div>
                <div class="field-info">
                  <div class="field-top">
                    <span class="field-name">{field.name}</span>
                    <span class="type-badge">{fieldTypeBadge(field)}</span>
                    {#if !field.optional}
                      <span class="req-badge required-badge">REQUIRED</span>
                    {:else}
                      <span class="req-badge optional-badge">OPTIONAL</span>
                    {/if}
                  </div>
                  {#if field.description}
                    <span class="field-desc">{field.description}</span>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}

        </div>

        <div class="right-col">
          <div class="health-panel">
            <h3 class="panel-title">Schema Health Map</h3>
            <div class="health-grid">
              {#each parsedFields as field, i}
                <div
                  class="health-cell"
                  title="{field.name}: {field.optional ? 'optional' : 'required'}"
                  style="background: {healthColor(field, i)}"
                ></div>
              {/each}
              {#if parsedFields.length === 0}
                {#each Array(12) as _}
                  <div class="health-cell" style="background: var(--surface-container-high)"></div>
                {/each}
              {/if}
            </div>
            <div class="health-bars">
              <div class="health-bar-row">
                <div class="bar-label"><span>Structural Integrity</span><span class="bar-val">{structuralIntegrity}%</span></div>
                <div class="bar-track"><div class="bar-fill" style="width: {structuralIntegrity}%"></div></div>
              </div>
              <div class="health-bar-row">
                <div class="bar-label"><span>Constraint Density</span><span class="bar-val">{constraintDensity}%</span></div>
                <div class="bar-track"><div class="bar-fill" style="width: {constraintDensity}%"></div></div>
              </div>
              <div class="health-bar-row">
                <div class="bar-label"><span>Description Coverage</span><span class="bar-val">{descCoverage}%</span></div>
                <div class="bar-track"><div class="bar-fill" style="width: {descCoverage}%"></div></div>
              </div>
            </div>
          </div>

          <!-- Schema Optimizer -->
          <div class="optimizer-panel">
            <div class="optimizer-header">
              <span class="msicon optimizer-icon">bolt</span>
              <div class="optimizer-titles">
                <span class="optimizer-title">Schema Optimizer</span>
                <span class="optimizer-sub">SCHEMA_INTELLIGENCE_V2</span>
              </div>
            </div>

            <div class="optimizer-messages" bind:this={optimizerEl}>
              {#if optimizerHistory.length === 0 && !optimizerLoading}
                <div class="optimizer-empty">
                  <p>Ask me to suggest improvements, validate field names, or add new data points.</p>
                  <div class="optimizer-prompts">
                    <button class="opt-prompt" onclick={() => { optimizerInput = 'What fields am I missing?'; sendOptimizer(); }}>What fields am I missing?</button>
                    <button class="opt-prompt" onclick={() => { optimizerInput = 'Review my required fields'; sendOptimizer(); }}>Review required fields</button>
                  </div>
                </div>
              {:else}
                {#each optimizerHistory as msg}
                  {#if msg.role === 'user'}
                    <div class="opt-msg opt-msg--user">{msg.content}</div>
                  {:else}
                    <div class="opt-msg opt-msg--assistant">
                      <p class="opt-msg-body">{msg.content}</p>
                      <button class="opt-apply-btn" onclick={enterEditMode}>
                        <span class="msicon" style="font-size:13px">edit</span>
                        Apply Changes
                      </button>
                    </div>
                  {/if}
                {/each}
                {#if optimizerLoading}
                  <div class="opt-msg opt-msg--assistant">
                    <span class="opt-dot"></span><span class="opt-dot"></span><span class="opt-dot"></span>
                  </div>
                {/if}
              {/if}
            </div>

            <div class="optimizer-input-row">
              <input
                class="optimizer-input"
                type="text"
                placeholder="Ask AI about this schema…"
                bind:value={optimizerInput}
                onkeydown={handleOptimizerKey}
                disabled={optimizerLoading}
              />
              <button class="optimizer-send" onclick={sendOptimizer} disabled={optimizerLoading || !optimizerInput.trim()}>
                <span class="msicon" style="font-size:16px">send</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </main>

  <div class="watermark">SCH</div>
</div>

<style>
  .schemas-root {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  /* Sidebar */
  .schemas-sidebar {
    width: 240px;
    flex-shrink: 0;
    background: var(--surface-container-low);
    border-right: 1px solid var(--c-border-light);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem 1.25rem 0.75rem;
    flex-shrink: 0;
  }
  .sidebar-title {
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--on-surface);
    letter-spacing: -0.01em;
  }
  .new-schema-btn {
    all: unset;
    cursor: pointer;
    color: var(--on-surface-muted);
    display: flex;
    align-items: center;
    padding: 0.25rem;
    transition: color 0.15s;
  }
  .new-schema-btn:hover { color: #ff590a; }

  .sidebar-search {
    position: relative;
    padding: 0 0.75rem 0.75rem;
    flex-shrink: 0;
  }
  .search-icon {
    position: absolute;
    left: 1.1rem;
    top: 50%;
    transform: translateY(-60%);
    font-size: 14px;
    color: var(--on-surface-muted);
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-container);
    border: none;
    outline: none;
    padding: 0.45rem 0.75rem 0.45rem 2rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    color: var(--on-surface);
    letter-spacing: 0.04em;
    margin: 0;
  }
  .search-input::placeholder { color: var(--on-surface-muted); }

  .schema-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.5rem;
  }
  .sidebar-empty {
    padding: 1rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    color: var(--on-surface-muted);
    text-align: center;
  }
  .schema-item {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem;
    width: 100%;
    box-sizing: border-box;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.72rem;
    color: var(--on-surface-muted);
    transition: color 0.15s, background 0.15s;
    border-radius: 2px;
  }
  .schema-item:hover { color: var(--on-surface); background: var(--surface-container); }
  .schema-item.active {
    color: var(--on-surface);
    background: var(--surface-container-high);
    border-left: 2px solid #ff590a;
    padding-left: calc(0.75rem - 2px);
  }
  .schema-icon { font-size: 15px; flex-shrink: 0; }
  .schema-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-bottom {
    padding: 0.75rem;
    flex-shrink: 0;
    border-top: 1px solid var(--c-border-light);
  }
  .new-full-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    background: var(--primary-container);
    color: var(--on-primary-fixed);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    transition: opacity 0.15s;
  }
  .new-full-btn:hover { opacity: 0.88; }

  /* Main area */
  .schemas-main {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.5rem;
    min-width: 0;
  }

  .no-selection {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 60vh;
    gap: 1rem;
    color: var(--on-surface-muted);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
  }

  /* Schema header */
  .schema-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 2rem;
    margin-bottom: 2rem;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .crumb-dim, .crumb-sep {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .crumb-active {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #ff590a;
  }
  .schema-title {
    font-family: 'Inter', sans-serif;
    font-size: 2rem;
    font-weight: 800;
    color: var(--on-surface);
    margin: 0 0 0.3rem;
    letter-spacing: -0.03em;
  }
  .schema-meta {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    color: var(--on-surface-muted);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .schema-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .schema-stats {
    display: flex;
    gap: 0.5rem;
    margin-right: 0.5rem;
  }
  .stat-chip {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    color: var(--on-surface-muted);
  }
  .stat-chip.valid { color: #22c55e; border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.06); }
  .stat-chip-val {
    font-family: 'Inter', sans-serif;
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--on-surface);
  }
  .stat-chip-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .action-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    background: var(--surface-container);
    transition: color 0.15s, background 0.15s;
  }
  .action-btn:hover { color: var(--on-surface); background: var(--surface-container-high); }
  .action-btn.primary-action {
    background: var(--primary-container);
    color: var(--on-primary-fixed);
  }
  .action-btn.primary-action:hover { opacity: 0.88; }
  .action-btn.primary { color: var(--on-surface); background: var(--surface-container-high); }
  .action-btn.primary:hover { color: #ff590a; }
  .action-btn.danger:hover { color: #ef4444; }
  .action-btn:disabled { opacity: 0.4; pointer-events: none; }

  /* Edit title input */
  .edit-name-row { margin-bottom: 0.3rem; }
  .edit-title-input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--on-surface);
    font-family: 'Inter', sans-serif;
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    padding: 0;
    width: 100%;
    max-width: 500px;
    margin: 0;
  }

  /* Error bar */
  .error-bar {
    background: rgba(147,0,10,0.12);
    border: 1px solid rgba(239,68,68,0.2);
    color: var(--error);
    font-size: 0.75rem;
    padding: 0.6rem 1rem;
    margin-bottom: 1.5rem;
    font-family: 'Space Grotesk', sans-serif;
  }

  /* Content grid */
  .content-grid {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 2rem;
    align-items: start;
  }

  .fields-col { display: flex; flex-direction: column; gap: 0.5rem; }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--c-border-light);
    margin-bottom: 0.75rem;
  }
  .section-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    font-weight: 700;
  }
  .section-hint {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    color: var(--on-surface-muted);
    font-style: italic;
  }
  .no-fields {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.72rem;
    color: var(--on-surface-muted);
    padding: 1.5rem 0;
  }

  /* View mode field card */
  .field-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--surface-container-low);
    border-left: 2px solid var(--c-border);
    transition: background 0.15s;
  }
  .field-card:hover { background: var(--surface-container); }
  .field-card.required { border-left-color: #ff590a; }

  .drag-indicator {
    flex-shrink: 0;
    opacity: 0.3;
    display: flex;
    align-items: center;
  }
  .field-card:hover .drag-indicator { opacity: 0.7; }

  .field-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .field-top { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .field-name {
    font-family: 'Inter', sans-serif;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--on-surface);
  }
  .type-badge {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    color: var(--on-surface-muted);
    background: var(--surface-container-highest);
    padding: 0.15rem 0.45rem;
  }
  .req-badge {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    padding: 0.15rem 0.45rem;
  }
  .required-badge { color: #ff590a; background: rgba(255,89,10,0.1); border: 1px solid rgba(255,89,10,0.2); }
  .optional-badge { color: var(--on-surface-muted); background: var(--surface-container-high); border: 1px solid var(--c-border-light); }
  .field-desc {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.7rem;
    color: var(--on-surface-muted);
    line-height: 1.4;
  }

  /* Edit mode field card */
  .edit-field-card {
    background: var(--surface-container-low);
    border-left: 2px solid var(--c-border);
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: background 0.15s;
  }
  .edit-field-card:focus-within {
    background: var(--surface-container);
    border-left-color: rgba(255,89,10,0.5);
  }
  .ef-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .ef-name-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--c-border);
    outline: none;
    color: var(--on-surface);
    font-family: 'Inter', sans-serif;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.1rem 0;
    margin: 0;
    transition: border-color 0.15s;
  }
  .ef-name-input:focus { border-bottom-color: #ff590a; }
  .ef-name-input::placeholder { color: var(--on-surface-muted); font-weight: 400; }

  .ef-opt-btn {
    all: unset;
    cursor: pointer;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--c-border);
    color: var(--on-surface-muted);
    background: var(--surface-container-high);
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .ef-opt-btn.required {
    color: #ff590a;
    background: rgba(255,89,10,0.1);
    border-color: rgba(255,89,10,0.3);
  }
  .ef-opt-btn:hover { opacity: 0.75; }

  .ef-remove {
    all: unset;
    cursor: pointer;
    color: var(--on-surface-muted);
    display: flex;
    align-items: center;
    padding: 0.2rem;
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .ef-remove:hover { color: #ef4444; }

  .ef-desc-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    outline: none;
    color: var(--on-surface-muted);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.72rem;
    padding: 0.1rem 0;
    width: 100%;
    margin: 0;
    transition: border-color 0.15s;
  }
  .ef-desc-input:focus { border-bottom-color: var(--c-border); color: var(--on-surface); }
  .ef-desc-input::placeholder { color: var(--on-surface-muted); opacity: 0.5; }

  /* Append / add field button */
  .append-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    padding: 1.5rem;
    border: 2px dashed var(--c-border);
    color: var(--on-surface-muted);
    transition: border-color 0.2s, color 0.2s, background 0.2s;
    margin-top: 0.25rem;
  }
  .append-btn:hover {
    border-color: rgba(255,89,10,0.4);
    color: #ff590a;
    background: rgba(255,89,10,0.04);
  }
  .append-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    font-weight: 700;
  }

  /* Advanced settings toggle */
  .advanced-toggle {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.85rem 0;
    border-top: 1px solid var(--c-border-light);
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.75rem;
    transition: color 0.15s;
  }
  .advanced-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .advanced-toggle:hover .advanced-label { color: var(--on-surface); }
  .advanced-hint {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    color: var(--on-surface-muted);
    margin-left: auto;
    font-style: italic;
    opacity: 0.7;
  }

  /* Advanced panel */
  .advanced-panel {
    background: var(--surface-container-low);
    border: 1px solid var(--c-border-light);
    padding: 1.25rem;
    margin-top: 0.25rem;
  }
  .adv-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }
  .adv-field { display: flex; flex-direction: column; gap: 0.3rem; }
  .adv-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .adv-hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.58rem;
    opacity: 0.7;
  }
  .adv-input {
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    outline: none;
    color: var(--on-surface);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
    padding: 0.4rem 0.6rem;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    transition: border-color 0.15s;
    border-radius: 0;
  }
  .adv-input:focus { border-color: #ff590a; }
  .adv-select {
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    outline: none;
    color: var(--on-surface);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
    padding: 0.4rem 0.6rem;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    cursor: pointer;
    appearance: none;
    border-radius: 0;
  }
  .adv-select:focus { border-color: #ff590a; }
  .adv-textarea {
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    outline: none;
    color: var(--on-surface);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    padding: 0.5rem 0.6rem;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    resize: vertical;
    line-height: 1.6;
    border-radius: 0;
    transition: border-color 0.15s;
  }
  .adv-textarea:focus { border-color: #ff590a; }

  /* Right panel */
  .right-col {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    position: sticky;
    top: 0;
  }

  .health-panel {
    background: var(--surface-container);
    padding: 1.25rem;
    border: 1px solid var(--c-border-light);
  }
  .logs-panel {
    background: var(--surface-container-highest);
    padding: 1.25rem;
    position: relative;
    overflow: hidden;
  }
  .logs-bg-icon {
    position: absolute;
    right: -0.5rem;
    bottom: -0.5rem;
    font-size: 5rem;
    opacity: 0.04;
    pointer-events: none;
  }
  .panel-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    font-weight: 700;
    margin: 0 0 1rem;
  }

  .health-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3px;
    margin-bottom: 1.25rem;
  }
  .health-cell { height: 28px; border-radius: 1px; }

  .health-bars { display: flex; flex-direction: column; gap: 0.75rem; }
  .health-bar-row { display: flex; flex-direction: column; gap: 0.3rem; }
  .bar-label {
    display: flex;
    justify-content: space-between;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .bar-val { color: var(--on-surface); font-weight: 700; }
  .bar-track {
    width: 100%;
    height: 2px;
    background: var(--surface-container-high);
  }
  .bar-fill {
    height: 100%;
    background: #ff590a;
    transition: width 0.4s ease;
  }

  .log-entries { display: flex; flex-direction: column; gap: 0.3rem; }
  .log-line {
    font-family: 'Space Grotesk', monospace;
    font-size: 0.65rem;
    color: var(--on-surface-muted);
    margin: 0;
    line-height: 1.5;
  }
  .log-line.ok { color: rgba(34,197,94,0.7); }
  .log-line.accent { color: #ff590a; }

  /* Schema Optimizer */
  .optimizer-panel {
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 420px;
  }
  .optimizer-header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--c-border-light);
    flex-shrink: 0;
  }
  .optimizer-icon {
    color: var(--primary-container);
    font-size: 18px;
    flex-shrink: 0;
  }
  .optimizer-titles { display: flex; flex-direction: column; gap: 0.1rem; }
  .optimizer-title {
    font-family: 'Inter', sans-serif;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--on-surface);
    letter-spacing: -0.01em;
  }
  .optimizer-sub {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.52rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }

  .optimizer-messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-height: 100px;
  }
  .optimizer-empty {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }
  .optimizer-empty p {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    color: var(--on-surface-muted);
    line-height: 1.5;
    margin: 0;
  }
  .optimizer-prompts {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .opt-prompt {
    all: unset;
    cursor: pointer;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    color: var(--on-surface-muted);
    background: var(--surface-container-high);
    padding: 0.4rem 0.65rem;
    transition: color 0.15s, background 0.15s;
    text-align: left;
  }
  .opt-prompt:hover { color: var(--on-surface); background: var(--surface-container-highest); }

  .opt-msg {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    line-height: 1.5;
  }
  .opt-msg--user {
    color: var(--on-surface-muted);
    font-style: italic;
    padding: 0.25rem 0;
    border-top: 1px solid var(--c-border-light);
  }
  .opt-msg--assistant {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--surface-container-high);
    padding: 0.65rem 0.75rem;
    border-left: 2px solid var(--primary-container);
  }
  .opt-msg-body {
    color: var(--on-surface);
    margin: 0;
    white-space: pre-wrap;
  }
  .opt-apply-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.65rem;
    background: var(--primary-container);
    color: var(--on-primary-fixed);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 700;
    align-self: flex-start;
    transition: opacity 0.15s;
  }
  .opt-apply-btn:hover { opacity: 0.85; }

  .opt-dot {
    display: inline-block;
    width: 4px; height: 4px;
    border-radius: 50%;
    background: var(--on-surface-muted);
    margin-right: 3px;
    animation: opt-bounce 1.2s infinite;
  }
  .opt-dot:nth-child(2) { animation-delay: 0.2s; }
  .opt-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes opt-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-3px); opacity: 1; }
  }

  .optimizer-input-row {
    display: flex;
    border-top: 1px solid var(--c-border-light);
    flex-shrink: 0;
  }
  .optimizer-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--on-surface);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.7rem;
    padding: 0.65rem 0.85rem;
    margin: 0;
  }
  .optimizer-input::placeholder { color: var(--on-surface-muted); }
  .optimizer-send {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    color: var(--on-surface-muted);
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .optimizer-send:hover:not(:disabled) { color: var(--primary-container); }
  .optimizer-send:disabled { opacity: 0.3; cursor: not-allowed; }

  /* Watermark */
  .watermark {
    position: fixed;
    bottom: 2rem;
    right: 2.5rem;
    font-family: 'Inter', sans-serif;
    font-size: 6rem;
    font-weight: 900;
    color: var(--on-surface);
    opacity: 0.025;
    letter-spacing: -0.05em;
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
</style>
