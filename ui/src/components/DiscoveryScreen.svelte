<script lang="ts">
  import { generateSchema, saveSchema, startIndexJob } from '../lib/api';

  type Screen = 'discovery' | 'monitor' | 'schemas' | 'sources' | 'history';

  const { onNavigate }: { onNavigate: (s: Screen) => void } = $props();

  interface FieldRow {
    name: string;
    optional: boolean;
    description: string;
  }

  let topic = $state('');
  let analyzing = $state(false);
  let schemaReady = $state(false);
  let fields = $state<FieldRow[]>([]);
  let schemaId = $state('');
  let schemaDisplayName = $state('');
  let schemaMeta = $state({ urlField: 'url', dedupeKey: [] as string[], trackedFields: [] as string[], namingRules: [] as string[] });
  let depth = $state(2);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const depthToIterations = [10, 25, 50, 100, 200];
  const depthDescriptions = [
    'Shallow scan — fast results from top sources only.',
    'Standard scan — direct sources and first-level neighbors.',
    'Deep scan — broader coverage with relational context.',
    'Thorough scan — comprehensive multi-source indexing.',
    'Exhaustive scan — maximum coverage, all available nodes.',
  ];

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  }

  async function handleAnalyze() {
    if (!topic.trim() || analyzing) return;
    analyzing = true;
    error = null;
    schemaReady = false;
    fields = [];

    const res = await generateSchema(topic.trim());
    analyzing = false;

    if (res.error || !res.schema) {
      error = res.error ?? 'Failed to generate schema. Check your API key in Settings.';
      return;
    }

    const s = res.schema;
    schemaId = s.id;
    schemaDisplayName = s.display_name;
    schemaMeta = {
      urlField: s.url_field || 'url',
      dedupeKey: s.dedupe_key ?? [],
      trackedFields: s.tracked_fields ?? [],
      namingRules: s.naming_rules ?? [],
    };
    fields = s.fields.map(f => ({ name: f.name, optional: f.optional ?? false, description: f.description }));
    schemaReady = true;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleAnalyze();
  }

  function addField() {
    fields = [...fields, { name: '', optional: false, description: '' }];
  }

  function removeField(i: number) {
    fields = fields.filter((_, idx) => idx !== i);
  }

  function toggleOptional(i: number) {
    fields = fields.map((f, idx) => idx === i ? { ...f, optional: !f.optional } : f);
  }

  function updateFieldName(i: number, value: string) {
    fields = fields.map((f, idx) => idx === i ? { ...f, name: value } : f);
  }

  async function handleStart() {
    if (!schemaReady || !topic.trim() || submitting) return;
    submitting = true;
    error = null;

    const flds = fields
      .filter(f => f.name.trim())
      .map(f => ({ name: f.name.trim(), type: 'string', optional: f.optional, description: f.description.trim() }));

    const body = {
      id: schemaId,
      display_name: schemaDisplayName,
      fields: flds,
      dedupe_key: schemaMeta.dedupeKey,
      url_field: schemaMeta.urlField,
      tracked_fields: schemaMeta.trackedFields,
      naming_rules: schemaMeta.namingRules,
    };

    // Try POST, fall back to PUT if schema id already exists
    let saveRes = await saveSchema(body, null) as { error?: string; ok?: boolean };
    if (saveRes.ok === false) {
      saveRes = await saveSchema(body, schemaId) as { error?: string; ok?: boolean };
      if (saveRes.ok === false) {
        error = saveRes.error ?? 'Failed to save schema';
        submitting = false;
        return;
      }
    }

    const output = slugify(topic);
    const maxIterations = depthToIterations[depth - 1];
    const jobRes = await startIndexJob({ topic: topic.trim(), schema: schemaId, output, maxIterations });
    submitting = false;

    if (jobRes.error) {
      error = jobRes.error;
      return;
    }

    onNavigate('history');
  }

  const canStart = $derived(schemaReady && topic.trim().length > 0 && !submitting);
</script>

<div class="discovery">

  <!-- Hero -->
  <section class="hero">
    <p class="hero-eyebrow">Precision Search</p>
    <h1 class="hero-title">Discover what's<br>hidden in the noise.</h1>

    <div class="search-wrap" class:focused={false}>
      <div class="search-bar">
        <span class="msicon search-icon">search</span>
        <input
          class="search-input"
          type="text"
          placeholder="Enter what you'd like to search for..."
          bind:value={topic}
          onkeydown={handleKeydown}
          disabled={analyzing}
        />
        <button
          class="analyze-btn"
          onclick={handleAnalyze}
          disabled={!topic.trim() || analyzing}
        >
          {#if analyzing}
            <span class="analyze-spinner"></span>
          {:else}
            Analyze
          {/if}
        </button>
      </div>
    </div>
  </section>

  <!-- Content grid (shown after analyze) -->
  {#if schemaReady || analyzing}
    <section class="content-grid">

      <!-- AI Schema Generator -->
      <div class="schema-panel">
        <div class="schema-panel-header">
          <span class="dot-pulse"></span>
          <span class="schema-panel-label">AI Schema Generator</span>
        </div>

        {#if analyzing}
          <div class="schema-loading">
            <span class="schema-loading-dot"></span>
            <span class="schema-loading-dot"></span>
            <span class="schema-loading-dot"></span>
          </div>
        {:else}
          <p class="schema-panel-desc">
            Based on your search intent, I've synthesised a semantic model for data extraction:
          </p>

          <div class="schema-fields">
            {#each fields as field, i}
              <div class="schema-field">
                <input
                  class="field-name-input"
                  type="text"
                  value={field.name}
                  oninput={(e) => updateFieldName(i, (e.target as HTMLInputElement).value)}
                  placeholder="fieldName"
                />
                <div class="field-right">
                  <button
                    class="field-opt-toggle"
                    class:required={!field.optional}
                    onclick={() => toggleOptional(i)}
                    title="Toggle optional"
                  >
                    {field.optional ? 'OPTIONAL' : 'REQUIRED'}
                  </button>
                  <button class="field-remove" onclick={() => removeField(i)} title="Remove field">
                    <span class="msicon" style="font-size:16px">close</span>
                  </button>
                </div>
              </div>
            {/each}

            <button class="field-add" onclick={addField}>
              <span class="msicon" style="font-size:16px">add_circle</span>
              <span class="field-add-label">Add node...</span>
            </button>
          </div>
        {/if}
      </div>

      <!-- Right column -->
      <div class="right-col">

        <!-- Depth card -->
        <div class="depth-card">
          <h3 class="depth-title">Search Depth</h3>
          <div class="depth-slider-wrap">
            <input
              class="depth-slider"
              type="range"
              min="1"
              max="5"
              step="1"
              bind:value={depth}
            />
            <div class="depth-labels">
              {#each [1,2,3,4,5] as n}
                <div class="depth-label" class:active={depth === n}>
                  <span class="depth-n">{n}</span>
                  {#if n === 1}<span class="depth-name">Shallow</span>{/if}
                  {#if n === 5}<span class="depth-name">Deep</span>{/if}
                </div>
              {/each}
            </div>
          </div>
          <div class="depth-desc">
            "{depthDescriptions[depth - 1]}"
          </div>
        </div>

        <!-- Start button -->
        <div class="start-wrap">
          <button
            class="start-btn"
            onclick={handleStart}
            disabled={!canStart}
          >
            {#if submitting}
              <span class="analyze-spinner" style="border-color:var(--on-primary-fixed);border-top-color:transparent"></span>
              Starting…
            {:else}
              Start Extraction
              <span class="msicon" style="font-size:20px">bolt</span>
            {/if}
          </button>
          <p class="est-label">Est. {depthToIterations[depth - 1]} iterations · {schemaId}</p>
        </div>

      </div>
    </section>
  {/if}

  {#if error}
    <div class="error-bar">{error}</div>
  {/if}

  <!-- Feature blurbs (shown when idle) -->
  {#if !schemaReady && !analyzing}
    <section class="features">
      <div class="feature">
        <span class="msicon feature-icon">analytics</span>
        <h4 class="feature-title">Discovery Mode</h4>
        <p class="feature-body">Real-time indexing across the web, guided by your schema definition.</p>
      </div>
      <div class="feature">
        <span class="msicon feature-icon">history_edu</span>
        <h4 class="feature-title">Schema History</h4>
        <p class="feature-body">Access and refine previously generated schemas from the Schemas tab.</p>
      </div>
      <div class="feature">
        <span class="msicon feature-icon">terminal</span>
        <h4 class="feature-title">Structured Output</h4>
        <p class="feature-body">Every extraction produces a typed, deduplicated dataset ready to export.</p>
      </div>
    </section>
  {/if}

</div>

<style>
  .discovery {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 3rem 2.5rem 4rem;
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ─── Hero ─── */
  .hero { margin-bottom: 3rem; }

  .hero-eyebrow {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--primary-container);
    margin-bottom: 1rem;
  }

  .hero-title {
    font-family: 'Inter', sans-serif;
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 900;
    color: var(--on-surface);
    letter-spacing: -0.03em;
    line-height: 1.05;
    margin-bottom: 2rem;
  }

  /* ─── Search bar ─── */
  .search-wrap { position: relative; max-width: 860px; }
  .search-wrap::before {
    content: '';
    position: absolute;
    inset: -1px;
    background: linear-gradient(90deg, rgba(255,89,10,0.15) 0%, transparent 60%);
    filter: blur(20px);
    opacity: 0;
    transition: opacity 0.4s;
    pointer-events: none;
    border-radius: 2px;
  }
  .search-wrap:focus-within::before { opacity: 1; }

  .search-bar {
    display: flex;
    align-items: center;
    background: var(--surface-container-high);
    border-bottom: 1px solid rgba(91,64,55,0.3);
    transition: border-color 0.3s;
  }
  .search-bar:focus-within {
    border-bottom-color: rgba(255,89,10,0.5);
  }

  .search-icon {
    margin-left: 1.25rem;
    color: var(--on-surface-muted);
    font-size: 22px;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--on-surface);
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    padding: 1.5rem 1.25rem;
    margin: 0;
    caret-color: var(--primary-container);
  }
  .search-input::placeholder { color: var(--on-surface-muted); }
  .search-input:disabled { opacity: 0.6; }

  .analyze-btn {
    all: unset;
    cursor: pointer;
    background: var(--primary-container);
    color: var(--on-primary-fixed);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.85rem 1.5rem;
    margin: 0.5rem;
    border-radius: 2px;
    flex-shrink: 0;
    transition: opacity 0.15s, box-shadow 0.15s;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .analyze-btn:hover:not(:disabled) {
    opacity: 0.9;
    box-shadow: 0 0 16px rgba(255, 89, 10, 0.3);
  }
  .analyze-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .analyze-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--on-primary-fixed);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ─── Content grid ─── */
  .content-grid {
    display: grid;
    grid-template-columns: 7fr 5fr;
    gap: 2rem;
    margin-bottom: 2rem;
    align-items: start;
  }

  /* ─── Schema panel ─── */
  .schema-panel {
    background: var(--surface-container);
    border-left: 2px solid var(--primary-container);
    padding: 1.75rem;
    position: relative;
    overflow: hidden;
  }
  .schema-panel::before {
    content: 'schema';
    font-family: 'Material Symbols Outlined';
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    font-size: 6rem;
    color: var(--on-surface);
    opacity: 0.03;
    pointer-events: none;
    user-select: none;
    font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 48;
  }

  .schema-panel-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
  }
  .dot-pulse {
    width: 6px;
    height: 6px;
    background: var(--primary-container);
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 8px var(--primary-container);
    animation: glow-pulse 2s ease-in-out infinite;
  }
  @keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 4px rgba(255,89,10,0.6); }
    50% { box-shadow: 0 0 12px rgba(255,89,10,0.9); }
  }
  .schema-panel-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }

  .schema-panel-desc {
    font-size: 0.8rem;
    color: var(--on-surface-muted);
    line-height: 1.6;
    margin-bottom: 1.25rem;
  }

  /* Schema loading dots */
  .schema-loading {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 1.5rem 0;
  }
  .schema-loading-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--primary-container);
    opacity: 0.4;
    animation: bounce 1.2s ease-in-out infinite;
  }
  .schema-loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .schema-loading-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
    40% { transform: translateY(-4px); opacity: 1; }
  }

  /* Field rows */
  .schema-fields {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .schema-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0.85rem;
    background: var(--surface-container-low);
    transition: background 0.15s;
    gap: 0.75rem;
  }
  .schema-field:hover { background: var(--surface-container-highest); }

  .field-name-input {
    all: unset;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--on-surface);
    flex: 1;
    min-width: 0;
    cursor: text;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
  }
  .field-name-input::placeholder { color: var(--on-surface-muted); font-weight: 400; }
  .field-name-input:focus { color: var(--on-surface); }

  .field-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .field-opt-toggle {
    all: unset;
    cursor: pointer;
    font-family: 'Space Grotesk', monospace;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--on-surface-muted);
    transition: color 0.15s;
    white-space: nowrap;
    padding: 0 0.1rem;
  }
  .field-opt-toggle:hover { color: var(--on-surface); }
  .field-opt-toggle.required { color: var(--primary-container); }

  .field-remove {
    all: unset;
    cursor: pointer;
    color: var(--on-surface-muted);
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }
  .schema-field:hover .field-remove { opacity: 1; }
  .field-remove:hover { color: var(--error); }

  .field-add {
    all: unset;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    cursor: pointer;
    border: 1px dashed var(--c-border);
    margin-top: 3px;
    transition: border-color 0.15s;
  }
  .field-add:hover { border-color: rgba(255,89,10,0.3); }
  .field-add .msicon { color: var(--on-surface-muted); font-size: 16px; }
  .field-add:hover .msicon { color: var(--primary-container); }
  .field-add-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    font-style: italic;
  }
  .field-add:hover .field-add-label { color: var(--on-surface); }

  /* ─── Right column ─── */
  .right-col {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Depth card */
  .depth-card {
    background: var(--surface-container);
    padding: 1.75rem;
  }
  .depth-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    margin-bottom: 1.5rem;
  }

  .depth-slider-wrap { padding: 0 0.25rem; }
  .depth-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 2px;
    background: var(--surface-container-highest);
    outline: none;
    border: none;
    border-radius: 2px;
    margin: 0 0 1rem;
    cursor: pointer;
  }
  .depth-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--primary-container);
    cursor: pointer;
    border-radius: 2px;
    box-shadow: 0 0 8px rgba(255,89,10,0.4);
  }
  .depth-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--primary-container);
    cursor: pointer;
    border-radius: 2px;
    border: none;
  }

  .depth-labels {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0;
  }
  .depth-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
  .depth-n {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--on-surface-muted);
    transition: color 0.15s;
  }
  .depth-label.active .depth-n { color: var(--primary-container); }
  .depth-name {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.55rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }

  .depth-desc {
    margin-top: 1.25rem;
    padding: 0.85rem 1rem;
    background: var(--surface-container-low);
    border: 1px solid var(--c-border-light);
    font-size: 0.75rem;
    color: var(--on-surface-muted);
    line-height: 1.6;
    font-style: italic;
  }

  /* Start button */
  .start-wrap { display: flex; flex-direction: column; gap: 0.6rem; }
  .start-btn {
    all: unset;
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
    background: var(--primary-container);
    color: var(--on-primary-fixed);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    font-weight: 900;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    border-radius: 2px;
    transition: opacity 0.15s, box-shadow 0.2s, transform 0.1s;
  }
  .start-btn:not(:disabled):hover {
    opacity: 0.92;
    box-shadow: 0 0 24px rgba(255,89,10,0.35);
  }
  .start-btn:not(:disabled):active { transform: scale(0.985); }
  .start-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .est-label {
    font-family: 'Space Grotesk', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    text-align: center;
  }

  /* ─── Error bar ─── */
  .error-bar {
    background: rgba(147,0,10,0.2);
    border: 1px solid rgba(255,180,171,0.2);
    color: var(--error);
    font-size: 0.78rem;
    padding: 0.65rem 1rem;
    border-radius: 2px;
    margin-bottom: 1rem;
  }

  /* ─── Feature blurbs ─── */
  .features {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3rem;
    margin-top: 5rem;
    padding-top: 2.5rem;
    border-top: 1px solid var(--c-border-light);
  }
  .feature-icon {
    display: block;
    color: var(--primary-container);
    font-size: 22px;
    margin-bottom: 0.75rem;
  }
  .feature-title {
    font-family: 'Inter', sans-serif;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--on-surface);
    margin-bottom: 0.5rem;
  }
  .feature-body {
    font-size: 0.8rem;
    color: var(--on-surface-muted);
    line-height: 1.65;
  }
</style>
