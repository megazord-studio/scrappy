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
      statusText = 'id, display_name, at least one field, and url_field are required';
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

<div class="modal-backdrop" class:open onclick={handleBackdropClick}>
  <div class="modal" style="width:540px;max-width:95vw">
    <div class="modal-title">{editingId ? 'Edit Schema' : 'New Schema'}</div>
    <button class="modal-close" onclick={onClose}>✕</button>

    <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
      <div style="flex:1">
        <label>ID <span style="font-weight:normal;color:#888">(slug, no spaces)</span></label>
        <input type="text" bind:value={id} placeholder="fitnesscenter" disabled={idDisabled} />
      </div>
      <div style="flex:1">
        <label>Display name</label>
        <input type="text" bind:value={displayName} placeholder="Fitness Center Abos" />
      </div>
    </div>

    <label>Fields</label>
    <div style="margin-bottom:0.5rem">
      {#each fields as f, i}
        <div style="display:flex;gap:0.4rem;align-items:flex-start;margin-bottom:0.4rem">
          <input
            type="text"
            placeholder="name"
            value={f.name}
            oninput={(e) => updateField(i, 'name', (e.target as HTMLInputElement).value)}
            style="width:110px;flex-shrink:0"
          />
          <input
            type="text"
            placeholder="description"
            value={f.description}
            oninput={(e) => updateField(i, 'description', (e.target as HTMLInputElement).value)}
            style="flex:1"
          />
          <label style="display:flex;align-items:center;gap:0.25rem;font-weight:normal;font-size:0.72rem;white-space:nowrap;padding-top:0.5rem">
            <input
              type="checkbox"
              checked={f.optional}
              onchange={(e) => updateField(i, 'optional', (e.target as HTMLInputElement).checked)}
            /> opt
          </label>
          <button
            style="all:unset;color:#777;font-size:1rem;cursor:pointer;padding:0.25rem 0.3rem;line-height:1"
            title="Remove field"
            onclick={() => removeField(i)}
          >✕</button>
        </div>
      {/each}
    </div>
    <button style="width:auto;padding:0.2rem 0.7rem;font-size:0.75rem;margin-bottom:0.75rem" onclick={addField}>
      + Add field
    </button>

    <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
      <div style="flex:1">
        <label>Dedupe key <span style="font-weight:normal;color:#888">(comma-separated field names)</span></label>
        <input type="text" bind:value={dedupeKey} placeholder="centerName,aboName" />
      </div>
      <div style="flex:1">
        <label>URL field</label>
        <input type="text" bind:value={urlField} placeholder="url" />
      </div>
    </div>

    <label>Tracked fields <span style="font-weight:normal;color:#888">(comma-separated)</span></label>
    <input type="text" bind:value={rateFields} placeholder="preis" style="margin-bottom:0.75rem" />

    <label>Naming rules <span style="font-weight:normal;color:#888">(one per line, guides LLM on name normalisation)</span></label>
    <textarea
      bind:value={namingRules}
      rows="3"
      style="width:100%;background:#0d0d0d;color:#ccc;border:1px solid #1e1e1e;border-radius:4px;padding:0.4rem 0.6rem;font-size:0.78rem;resize:vertical;box-sizing:border-box;margin-bottom:0.75rem"
      placeholder="centerName: use the chain's official brand name, not the local branch name&#10;aboName: use the exact plan name as shown on the website"
    ></textarea>

    <button onclick={handleSave}>Save</button>
    {#if statusText}
      <div style="margin-top:0.5rem;font-size:0.8rem;color:{statusColor}">{statusText}</div>
    {/if}
  </div>
</div>
