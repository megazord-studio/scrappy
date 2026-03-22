<script lang="ts">
  import { getSchema, saveSchema } from '../../lib/api';

  const {
    open,
    editingId,
    onClose,
    onSaved,
  }: {
    open: boolean;
    editingId: string | null;
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  interface FieldRow {
    name: string;
    optional: boolean;
    description: string;
  }

  let id = $state('');
  let idDisabled = $state(false);
  let displayName = $state('');
  let dedupeKey = $state('');
  let urlField = $state('url');
  let rateFields = $state('');
  let namingRules = $state('');
  let fields = $state<FieldRow[]>([{ name: '', optional: false, description: '' }]);
  let statusText = $state('');
  let statusColor = $state('#4caf50');

  $effect(() => {
    if (open) {
      if (editingId) {
        loadSchema(editingId);
      } else {
        id = '';
        idDisabled = false;
        displayName = '';
        dedupeKey = '';
        urlField = 'url';
        rateFields = '';
        namingRules = '';
        fields = [{ name: '', optional: false, description: '' }];
        statusText = '';
      }
    }
  });

  async function loadSchema(schId: string) {
    const row = await getSchema(schId);
    id = row.id;
    idDisabled = true;
    displayName = row.display_name;
    dedupeKey = JSON.parse(row.dedupe_key as unknown as string).join(', ');
    urlField = row.url_field;
    rateFields = JSON.parse(row.rate_fields as unknown as string).join(', ');
    const namingArr = row.naming_rules ? JSON.parse(row.naming_rules as unknown as string) : [];
    namingRules = namingArr.join('\n');
    const parsedFields = JSON.parse(row.fields as unknown as string);
    fields = parsedFields.map((f: { name: string; optional: boolean; description: string }) => ({
      name: f.name,
      optional: f.optional,
      description: f.description,
    }));
    statusText = '';
  }

  function addField() {
    fields = [...fields, { name: '', optional: false, description: '' }];
  }

  function removeField(i: number) {
    fields = fields.filter((_, idx) => idx !== i);
  }

  function updateField(i: number, key: keyof FieldRow, value: string | boolean) {
    fields = fields.map((f, idx) => idx === i ? { ...f, [key]: value } : f);
  }

  async function handleSave() {
    const idVal = id.trim();
    const dnVal = displayName.trim();
    const ufVal = urlField.trim();
    const dk = dedupeKey.split(',').map(s => s.trim()).filter(Boolean);
    const rf = rateFields.split(',').map(s => s.trim()).filter(Boolean);
    const nr = namingRules.trim() ? namingRules.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const flds = fields.filter(f => f.name.trim()).map(f => ({
      name: f.name.trim(),
      type: 'string',
      optional: f.optional,
      description: f.description.trim(),
    }));

    if (!idVal || !dnVal || flds.length === 0 || !ufVal) {
      statusColor = '#f44336';
      statusText = 'ID, display name, at least one field, and URL field are required';
      return;
    }

    const body = { id: idVal, display_name: dnVal, fields: flds, dedupe_key: dk, url_field: ufVal, rate_fields: rf, naming_rules: nr };
    const res = await saveSchema(body, editingId) as { error?: string; ok?: boolean };
    if (res.ok === false) {
      statusColor = '#f44336';
      statusText = res.error ?? 'Failed to save';
      return;
    }
    onClose();
    onSaved();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-backdrop" class:open onclick={handleBackdropClick}>
  <div class="schema-modal">

    <div class="sm-header">
      <span class="sm-title">{editingId ? 'Edit Schema' : 'New Schema'}</span>
      <button class="sm-close" onclick={onClose}>✕</button>
    </div>

    <div class="sm-body">

      <!-- Identity -->
      <section class="sm-section">
        <div class="sm-section-head">
          <span class="sm-section-label">Identity</span>
        </div>
        <div class="sm-row-2">
          <div class="sm-field">
            <label class="sm-label" for="sm-id">ID <span class="sm-hint">slug, no spaces</span></label>
            <input id="sm-id" class="sm-input" type="text" bind:value={id} placeholder="3a-konto" disabled={idDisabled} />
          </div>
          <div class="sm-field">
            <label class="sm-label" for="sm-display-name">Display name</label>
            <input id="sm-display-name" class="sm-input" type="text" bind:value={displayName} placeholder="3a Konto" />
          </div>
        </div>
      </section>

      <!-- Fields -->
      <section class="sm-section">
        <div class="sm-section-head">
          <span class="sm-section-label">Fields</span>
          <span class="sm-section-desc">Data the scraper will extract from each result</span>
        </div>
        <div class="fields-list">
          {#each fields as f, i}
            <div class="field-card">
              <div class="field-top">
                <input
                  class="sm-input field-name-input"
                  type="text"
                  placeholder="fieldName"
                  value={f.name}
                  oninput={(e) => updateField(i, 'name', (e.target as HTMLInputElement).value)}
                />
                <label class="opt-toggle" title="Mark field as optional">
                  <input
                    type="checkbox"
                    checked={f.optional}
                    onchange={(e) => updateField(i, 'optional', (e.target as HTMLInputElement).checked)}
                  />
                  <span class="opt-label">optional</span>
                </label>
                <button class="field-remove" onclick={() => removeField(i)} title="Remove field">✕</button>
              </div>
              <input
                class="sm-input field-desc-input"
                type="text"
                placeholder="Describe what to extract (guides the AI)"
                value={f.description}
                oninput={(e) => updateField(i, 'description', (e.target as HTMLInputElement).value)}
              />
            </div>
          {/each}
        </div>
        <button class="add-field-btn" onclick={addField}>+ Add field</button>
      </section>

      <!-- Data settings -->
      <section class="sm-section">
        <div class="sm-section-head">
          <span class="sm-section-label">Data settings</span>
        </div>
        <div class="sm-row-3">
          <div class="sm-field">
            <label class="sm-label" for="sm-url-field">URL field</label>
            <input id="sm-url-field" class="sm-input" type="text" bind:value={urlField} placeholder="url" />
          </div>
          <div class="sm-field">
            <label class="sm-label" for="sm-dedupe-key">Dedupe key <span class="sm-hint">comma-separated</span></label>
            <input id="sm-dedupe-key" class="sm-input" type="text" bind:value={dedupeKey} placeholder="bankName, kontoName" />
          </div>
          <div class="sm-field">
            <label class="sm-label" for="sm-rate-fields">Tracked fields <span class="sm-hint">monitored for changes</span></label>
            <input id="sm-rate-fields" class="sm-input" type="text" bind:value={rateFields} placeholder="zins, ter" />
          </div>
        </div>
      </section>

      <!-- Naming rules -->
      <section class="sm-section">
        <div class="sm-section-head">
          <span class="sm-section-label">Naming rules <span class="sm-hint-inline">optional</span></span>
          <span class="sm-section-desc">One rule per line — guides the AI on how to normalise field values</span>
        </div>
        <textarea
          class="sm-textarea"
          bind:value={namingRules}
          rows="6"
          placeholder="kontoName: use the exact plan name as shown on the website&#10;bankName: use the chain's official brand name, not the local branch"
        ></textarea>
      </section>

    </div>

    <div class="sm-footer">
      {#if statusText}
        <span class="sm-status" style="color:{statusColor}">{statusText}</span>
      {/if}
      <button class="sm-save-btn" onclick={handleSave}>Save schema</button>
    </div>

  </div>
</div>

<style>
  .schema-modal {
    background: #111;
    border: 1px solid #222;
    border-radius: 8px;
    width: 780px;
    max-width: 96vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    position: relative;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  /* Header */
  .sm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #1e1e1e;
    flex-shrink: 0;
  }
  .sm-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #e0e0e0;
  }
  .sm-close {
    all: unset;
    cursor: pointer;
    color: #555;
    font-size: 0.9rem;
    line-height: 1;
    transition: color 0.15s;
  }
  .sm-close:hover { color: #aaa; }

  /* Body */
  .sm-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Sections */
  .sm-section {
    padding: 0.85rem 0;
    border-bottom: 1px solid #191919;
  }
  .sm-section:last-child { border-bottom: none; }

  .sm-section-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.65rem;
  }
  .sm-section-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #555;
    font-family: "IBM Plex Mono", monospace;
    flex-shrink: 0;
  }
  .sm-section-desc {
    font-size: 0.65rem;
    color: #444;
  }
  .sm-hint-inline {
    font-size: 0.58rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: #444;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  /* Field label + hint */
  .sm-label {
    display: block;
    font-size: 0.7rem;
    color: #777;
    margin-bottom: 0.3rem;
  }
  .sm-hint {
    font-weight: 400;
    color: #555;
    font-size: 0.65rem;
  }

  /* Input */
  .sm-input {
    width: 100%;
    background: #0d0d0d;
    border: 1px solid #1e1e1e;
    border-radius: 4px;
    padding: 0.38rem 0.55rem;
    color: #ccc;
    font-size: 0.78rem;
    margin-bottom: 0;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .sm-input:focus { border-color: #22d3ee; }
  .sm-input:disabled { color: #555; cursor: not-allowed; }

  /* Layout rows */
  .sm-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .sm-row-3 {
    display: grid;
    grid-template-columns: 1fr 1.4fr 1.4fr;
    gap: 0.75rem;
  }
  .sm-field { display: flex; flex-direction: column; }

  /* Fields list */
  .fields-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .field-card {
    background: #0d0d0d;
    border: 1px solid #1e1e1e;
    border-radius: 4px;
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    transition: border-color 0.15s;
  }
  .field-card:focus-within { border-color: #2a2a2a; }

  .field-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .field-name-input {
    width: 140px;
    flex-shrink: 0;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.74rem;
  }
  .field-desc-input {
    font-size: 0.75rem;
    color: #999;
  }

  .opt-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
    margin-left: auto;
    flex-shrink: 0;
  }
  .opt-toggle input[type="checkbox"] {
    width: auto;
    margin: 0;
    cursor: pointer;
    accent-color: #22d3ee;
  }
  .opt-label {
    font-size: 0.65rem;
    color: #555;
    white-space: nowrap;
    user-select: none;
  }
  .opt-toggle:has(input:checked) .opt-label { color: #22d3ee; }

  .field-remove {
    all: unset;
    cursor: pointer;
    color: #3a3a3a;
    font-size: 0.75rem;
    line-height: 1;
    padding: 0.2rem 0.25rem;
    border-radius: 2px;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .field-remove:hover { color: #f87171; }

  .add-field-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.7rem;
    color: #555;
    border: 1px dashed #252525;
    border-radius: 4px;
    padding: 0.35rem 0.75rem;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    transition: color 0.15s, border-color 0.15s;
  }
  .add-field-btn:hover { color: #aaa; border-color: #3a3a3a; }

  /* Textarea */
  .sm-textarea {
    width: 100%;
    background: #0d0d0d;
    border: 1px solid #1e1e1e;
    border-radius: 4px;
    padding: 0.45rem 0.6rem;
    color: #ccc;
    font-size: 0.75rem;
    font-family: "IBM Plex Mono", monospace;
    line-height: 1.6;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .sm-textarea:focus { border-color: #22d3ee; }

  /* Footer */
  .sm-footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #1e1e1e;
    flex-shrink: 0;
  }
  .sm-status {
    font-size: 0.72rem;
    flex: 1;
  }
  .sm-save-btn {
    all: unset;
    cursor: pointer;
    background: #22d3ee;
    color: #000;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 4px;
    padding: 0.45rem 1.1rem;
    margin-left: auto;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .sm-save-btn:hover { background: #06b6d4; }
</style>
