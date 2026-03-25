<script lang="ts">
  import { getSchema, saveSchema, generateSchema } from '../../lib/api';

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

  interface ChatMsg {
    role: 'user' | 'assistant';
    content: string;
  }

  // Form state
  let id = $state('');
  let idDisabled = $state(false);
  let displayName = $state('');
  let dedupeKey = $state('');
  let urlField = $state('url');
  let entityField = $state('');
  let rateFields = $state('');
  let namingRules = $state('');
  let fields = $state<FieldRow[]>([{ name: '', optional: false, description: '' }]);
  let statusText = $state('');
  let statusColor = $state('#4caf50');

  // Chat / new-schema state
  let chatInput = $state('');
  let chatMessages = $state<ChatMsg[]>([]);
  let generating = $state(false);
  let schemaDone = $state(false);
  let advancedOpen = $state(false);

  const isNew = $derived(!editingId);
  const canSave = $derived(
    schemaDone || (id.trim().length > 0 && displayName.trim().length > 0 && fields.some(f => f.name.trim()))
  );

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
        entityField = '';
        rateFields = '';
        namingRules = '';
        fields = [{ name: '', optional: false, description: '' }];
        statusText = '';
        chatInput = '';
        chatMessages = [];
        generating = false;
        schemaDone = false;
        advancedOpen = false;
      }
    }
  });

  async function handleGenerate() {
    const desc = chatInput.trim();
    if (!desc || generating) return;
    chatMessages = [...chatMessages, { role: 'user', content: desc }];
    chatInput = '';
    generating = true;
    const res = await generateSchema(desc);
    generating = false;
    if (res.error || !res.schema) {
      chatMessages = [...chatMessages, { role: 'assistant', content: `Sorry, I couldn't generate a schema: ${res.error ?? 'unknown error'}` }];
      return;
    }
    // Fill form from schema
    const s = res.schema;
    id = s.id;
    displayName = s.display_name;
    urlField = s.url_field || 'url';
    dedupeKey = (s.dedupe_key ?? []).join(', ');
    rateFields = (s.rate_fields ?? []).join(', ');
    namingRules = (s.naming_rules ?? []).join('\n');
    entityField = '';
    fields = s.fields.map(f => ({ name: f.name, optional: f.optional ?? false, description: f.description }));
    schemaDone = true;
    chatMessages = [...chatMessages, { role: 'assistant', content: res.reply }];
  }

  function handleChatKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  async function loadSchema(schId: string) {
    const row = await getSchema(schId);
    id = row.id;
    idDisabled = true;
    displayName = row.display_name;
    dedupeKey = JSON.parse(row.dedupe_key as unknown as string).join(', ');
    urlField = row.url_field;
    entityField = row.entity_field ?? '';
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

    const efVal = entityField.trim() || undefined;
    const body = { id: idVal, display_name: dnVal, fields: flds, dedupe_key: dk, url_field: ufVal, entity_field: efVal, rate_fields: rf, naming_rules: nr };
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
  <div class="schema-modal" class:schema-modal--new={isNew}>

    <div class="sm-header">
      <span class="sm-title">{editingId ? 'Edit Schema' : 'New Dataset'}</span>
      <button class="sm-close" onclick={onClose}>✕</button>
    </div>

    <div class="sm-body">

      {#if isNew}
        <!-- Chat interface -->
        <div class="chat-area">
          {#if chatMessages.length === 0 && !generating}
            <div class="chat-empty">
              <div class="chat-empty-title">What do you want to scrape?</div>
              <div class="chat-empty-body">Describe the data and I'll generate a schema for you.</div>
              <div class="chat-examples">
                <button class="chat-example" onclick={() => { chatInput = 'Swiss 3A pension fund interest rates by bank and plan'; }}>Swiss 3A fund rates</button>
                <button class="chat-example" onclick={() => { chatInput = 'Online schools offering AI and machine learning courses'; }}>AI school listings</button>
                <button class="chat-example" onclick={() => { chatInput = 'Mortgage rates from Swiss banks with LTV and term'; }}>Swiss mortgage rates</button>
              </div>
            </div>
          {:else}
            <div class="chat-messages">
              {#each chatMessages as msg}
                <div class="chat-msg chat-msg--{msg.role}">
                  <div class="chat-bubble">{msg.content}</div>
                </div>
              {/each}
              {#if generating}
                <div class="chat-msg chat-msg--assistant">
                  <div class="chat-bubble chat-bubble--thinking">
                    <span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        {#if schemaDone}
          <div class="schema-chip">
            <span class="schema-chip-icon">✓</span>
            <span class="schema-chip-name">{displayName}</span>
            <span class="schema-chip-meta">{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
          </div>
        {/if}

        <div class="chat-input-row">
          <textarea
            class="chat-input"
            bind:value={chatInput}
            placeholder={schemaDone ? 'Describe changes to refine…' : 'Describe what to scrape…'}
            rows="2"
            onkeydown={handleChatKey}
            disabled={generating}
          ></textarea>
          <button class="chat-send-btn" onclick={handleGenerate} disabled={generating || !chatInput.trim()}>
            {generating ? '…' : schemaDone ? 'Refine' : 'Generate →'}
          </button>
        </div>

        <button class="advanced-toggle" onclick={() => { advancedOpen = !advancedOpen; }}>
          <span class="advanced-arrow">{advancedOpen ? '▼' : '▶'}</span>
          Advanced
          {#if schemaDone}<span class="advanced-hint">review or edit the generated schema</span>{/if}
        </button>
      {/if}

      {#if !isNew || advancedOpen}
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
        <div class="sm-row-1">
          <div class="sm-field">
            <label class="sm-label" for="sm-entity-field">Entity field <span class="sm-hint">links records to cross-dataset entities</span></label>
            <select id="sm-entity-field" class="sm-select" bind:value={entityField}>
              <option value="">— none —</option>
              {#each fields.filter(f => f.name.trim()) as f}
                <option value={f.name.trim()}>{f.name.trim()}</option>
              {/each}
            </select>
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

      {/if}

    </div>

    <div class="sm-footer">
      {#if statusText}
        <span class="sm-status" style="color:{statusColor}">{statusText}</span>
      {/if}
      <button class="sm-save-btn" onclick={handleSave} disabled={isNew && !canSave}>
        {editingId ? 'Save changes' : 'Save schema'}
      </button>
    </div>

  </div>
</div>

<style>
  .schema-modal {
    background: #fff;
    border: 1px solid #dddbd5;
    border-radius: 14px;
    width: 780px;
    max-width: 96vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    position: relative;
    font-family: 'DM Sans', sans-serif;
    box-shadow: 0 8px 40px rgba(0,0,0,0.12);
  }

  /* Header */
  .sm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #ece9e3;
    flex-shrink: 0;
  }
  .sm-title {
    font-family: 'Syne', sans-serif;
    font-size: 0.9rem;
    font-weight: 700;
    color: #0e0d0b;
  }
  .sm-close {
    all: unset;
    cursor: pointer;
    color: #9b9892;
    font-size: 0.9rem;
    line-height: 1;
    transition: color 0.15s;
  }
  .sm-close:hover { color: #0e0d0b; }

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
    border-bottom: 1px solid #ece9e3;
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
    color: #9b9892;
    font-family: "IBM Plex Mono", monospace;
    flex-shrink: 0;
  }
  .sm-section-desc {
    font-size: 0.65rem;
    color: #9b9892;
  }
  .sm-hint-inline {
    font-size: 0.58rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: #9b9892;
    font-family: 'DM Sans', sans-serif;
  }

  /* Field label + hint */
  .sm-label {
    display: block;
    font-size: 0.7rem;
    color: #6b6860;
    margin-bottom: 0.3rem;
  }
  .sm-hint {
    font-weight: 400;
    color: #9b9892;
    font-size: 0.65rem;
  }

  /* Input */
  .sm-input {
    width: 100%;
    background: #f9f8f5;
    border: 1px solid #dddbd5;
    border-radius: 6px;
    padding: 0.38rem 0.55rem;
    color: #0e0d0b;
    font-size: 0.78rem;
    margin-bottom: 0;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .sm-input:focus { border-color: #22d3ee; }
  .sm-input:disabled { color: #9b9892; cursor: not-allowed; }

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
  .sm-row-1 {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .sm-field { display: flex; flex-direction: column; }

  /* Select */
  .sm-select {
    width: 100%;
    background: #f9f8f5;
    border: 1px solid #dddbd5;
    border-radius: 6px;
    padding: 0.45rem 0.65rem;
    font-size: 0.8rem;
    color: #0e0d0b;
    font-family: 'DM Sans', sans-serif;
    box-sizing: border-box;
    cursor: pointer;
    appearance: none;
  }
  .sm-select:focus { border-color: #22d3ee; outline: none; }

  /* Fields list */
  .fields-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .field-card {
    background: #faf9f6;
    border: 1px solid #e8e6e0;
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    transition: border-color 0.15s;
  }
  .field-card:focus-within { border-color: #dddbd5; }

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
    color: #6b6860;
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
    color: #9b9892;
    white-space: nowrap;
    user-select: none;
  }
  .opt-toggle:has(input:checked) .opt-label { color: #0e7490; }

  .field-remove {
    all: unset;
    cursor: pointer;
    color: #b8b6b0;
    font-size: 0.75rem;
    line-height: 1;
    padding: 0.2rem 0.25rem;
    border-radius: 2px;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .field-remove:hover { color: #dc2626; }

  .add-field-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.7rem;
    color: #9b9892;
    border: 1px dashed #dddbd5;
    border-radius: 6px;
    padding: 0.35rem 0.75rem;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    transition: color 0.15s, border-color 0.15s;
  }
  .add-field-btn:hover { color: #0e0d0b; border-color: #aaa; }

  /* Textarea */
  .sm-textarea {
    width: 100%;
    background: #f9f8f5;
    border: 1px solid #dddbd5;
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    color: #0e0d0b;
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
    border-top: 1px solid #ece9e3;
    flex-shrink: 0;
  }
  .sm-status {
    font-size: 0.72rem;
    flex: 1;
  }
  .sm-save-btn {
    all: unset;
    cursor: pointer;
    background: #0e7490;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 8px;
    padding: 0.45rem 1.1rem;
    margin-left: auto;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .sm-save-btn:hover { background: #0c6078; }
  .sm-save-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* New-mode width */
  .schema-modal--new {
    width: 560px;
  }

  /* Chat area */
  .chat-area {
    min-height: 160px;
    display: flex;
    flex-direction: column;
  }

  .chat-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem 1rem;
    text-align: center;
  }
  .chat-empty-title {
    font-family: 'Syne', sans-serif;
    font-size: 0.95rem;
    font-weight: 700;
    color: #0e0d0b;
  }
  .chat-empty-body {
    font-size: 0.75rem;
    color: #6b6860;
    max-width: 280px;
    line-height: 1.5;
  }
  .chat-examples {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: center;
    margin-top: 0.6rem;
  }
  .chat-example {
    all: unset;
    cursor: pointer;
    font-size: 0.7rem;
    color: #6b6860;
    border: 1px solid #dddbd5;
    border-radius: 20px;
    padding: 0.3rem 0.75rem;
    background: #faf9f6;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .chat-example:hover { color: #0e7490; border-color: #67e8f9; background: #ecfeff; }

  .chat-messages {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .chat-msg {
    display: flex;
  }
  .chat-msg--user { justify-content: flex-end; }
  .chat-msg--assistant { justify-content: flex-start; }

  .chat-bubble {
    max-width: 80%;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    font-size: 0.78rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .chat-msg--user .chat-bubble {
    background: #0e7490;
    color: #fff;
    border-bottom-right-radius: 3px;
  }
  .chat-msg--assistant .chat-bubble {
    background: #faf9f6;
    color: #0e0d0b;
    border: 1px solid #e8e6e0;
    border-bottom-left-radius: 3px;
  }

  .chat-bubble--thinking {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0.55rem 0.85rem;
  }
  .chat-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: #9b9892;
    animation: chat-bounce 1.2s infinite;
  }
  .chat-dot:nth-child(2) { animation-delay: 0.2s; }
  .chat-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes chat-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-4px); opacity: 1; }
  }

  /* Schema chip */
  .schema-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 0.45rem 0.75rem;
    margin: 0.5rem 0;
  }
  .schema-chip-icon { color: #16a34a; font-size: 0.8rem; flex-shrink: 0; }
  .schema-chip-name { font-size: 0.82rem; font-weight: 600; color: #0e0d0b; }
  .schema-chip-meta { font-size: 0.72rem; color: #6b6860; margin-left: auto; font-family: "IBM Plex Mono", monospace; }

  /* Chat input row */
  .chat-input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    margin-top: 0.5rem;
  }
  .chat-input {
    flex: 1;
    background: #f9f8f5;
    border: 1px solid #dddbd5;
    border-radius: 8px;
    padding: 0.45rem 0.65rem;
    color: #0e0d0b;
    font-size: 0.78rem;
    font-family: 'DM Sans', sans-serif;
    line-height: 1.5;
    resize: none;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .chat-input:focus { border-color: #22d3ee; }
  .chat-input::placeholder { color: #9b9892; }
  .chat-input:disabled { opacity: 0.5; }

  .chat-send-btn {
    all: unset;
    cursor: pointer;
    background: #0e7490;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 8px;
    padding: 0.5rem 1rem;
    white-space: nowrap;
    transition: background 0.15s, opacity 0.15s;
    flex-shrink: 0;
  }
  .chat-send-btn:hover { background: #0c6078; }
  .chat-send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Advanced toggle */
  .advanced-toggle {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.7rem;
    color: #9b9892;
    margin-top: 0.85rem;
    padding: 0.3rem 0;
    border-top: 1px solid #ece9e3;
    width: 100%;
    box-sizing: border-box;
    transition: color 0.12s;
  }
  .advanced-toggle:hover { color: #0e0d0b; }
  .advanced-arrow { font-size: 0.55rem; color: #9b9892; }
  .advanced-hint {
    font-size: 0.65rem;
    color: #9b9892;
    margin-left: auto;
    font-style: italic;
  }
</style>
