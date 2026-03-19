<script lang="ts">
  import { getSettings, saveSettings } from '../../lib/api';
  import type { Settings } from '../../lib/types';

  const { open, onClose }: { open: boolean; onClose: () => void } = $props();

  let provider = $state<'anthropic' | 'openai' | 'zordmind'>('anthropic');
  let anthropicAgentModel = $state('');
  let anthropicExtractModel = $state('');
  let openaiModel = $state('');
  let openaiExtractModel = $state('');
  let zordmindUrl = $state('');
  let zordmindModel = $state('');
  let crawl4aiBase = $state('');
  let apiKey = $state('');
  let webhookUrl = $state('');
  let copied = $state(false);
  let statusText = $state('');
  let statusColor = $state('#4caf50');

  $effect(() => {
    if (open) loadSettings();
  });

  async function loadSettings() {
    const s = await getSettings();
    provider = (s.llmProvider as 'anthropic' | 'openai' | 'zordmind') ?? 'anthropic';
    anthropicAgentModel = s.anthropicAgentModel ?? 'claude-opus-4-6';
    anthropicExtractModel = s.anthropicExtractModel ?? 'claude-haiku-4-5-20251001';
    openaiModel = s.openaiModel ?? 'gpt-5.4';
    openaiExtractModel = s.openaiExtractModel ?? 'gpt-5.4-mini';
    zordmindUrl = s.zordmindUrl ?? '';
    zordmindModel = s.zordmindModel ?? '';
    crawl4aiBase = s.crawl4aiBase ?? '';
    apiKey = s.apiKey ?? '';
    webhookUrl = s.webhookUrl ?? '';
    statusText = '';
  }

  async function handleSave() {
    const body: Settings = {
      llmProvider: provider,
      anthropicAgentModel: anthropicAgentModel.trim(),
      anthropicExtractModel: anthropicExtractModel.trim(),
      openaiModel: openaiModel.trim(),
      openaiExtractModel: openaiExtractModel.trim(),
      zordmindUrl: zordmindUrl.trim(),
      zordmindModel: zordmindModel.trim(),
      crawl4aiBase: crawl4aiBase.trim(),
      webhookUrl: webhookUrl.trim(),
    };
    const res = await saveSettings(body);
    if (res.ok) {
      statusColor = '#4caf50';
      statusText = 'Saved.';
      setTimeout(() => { statusText = ''; onClose(); }, 800);
    } else {
      statusColor = '#ef5350';
      statusText = 'Failed to save.';
      setTimeout(() => { statusText = ''; }, 2000);
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<div class="modal-backdrop" class:open onclick={handleBackdropClick}>
  <div class="modal">
    <div class="modal-title">Settings</div>
    <button class="modal-close" onclick={onClose}>✕</button>

    <label for="crawl4ai-base">Crawl4AI endpoint</label>
    <input id="crawl4ai-base" type="text" bind:value={crawl4aiBase} placeholder="https://crawl.naszilla.ch" style="margin-bottom:1rem" />

    <label>LLM Provider</label>
    <div style="display:flex;gap:1.25rem;margin-bottom:0.75rem;flex-wrap:wrap">
      {#each (['anthropic', 'openai', 'zordmind'] as const) as p}
        <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:normal">
          <input type="radio" name="llm-provider" value={p} checked={provider === p} onchange={() => { provider = p; }} />
          {p === 'anthropic' ? 'Anthropic' : p === 'openai' ? 'OpenAI' : 'ZordMind'}
        </label>
      {/each}
    </div>

    {#if provider === 'anthropic'}
      <div class="model-pair">
        <div>
          <label for="ant-agent-model">Agent model <span class="hint">(index, complex reasoning)</span></label>
          <input id="ant-agent-model" type="text" bind:value={anthropicAgentModel} placeholder="claude-opus-4-6" />
        </div>
        <div>
          <label for="ant-extract-model">Extract model <span class="hint">(update, lightweight)</span></label>
          <input id="ant-extract-model" type="text" bind:value={anthropicExtractModel} placeholder="claude-haiku-4-5-20251001" />
        </div>
      </div>
    {/if}

    {#if provider === 'openai'}
      <div class="model-pair">
        <div>
          <label for="openai-agent-model">Agent model <span class="hint">(index, complex reasoning)</span></label>
          <input id="openai-agent-model" type="text" bind:value={openaiModel} placeholder="gpt-5.4" />
        </div>
        <div>
          <label for="openai-extract-model">Extract model <span class="hint">(update, lightweight)</span></label>
          <input id="openai-extract-model" type="text" bind:value={openaiExtractModel} placeholder="gpt-5.4-mini" />
        </div>
      </div>
    {/if}

    {#if provider === 'zordmind'}
      <label for="zm-url">ZordMind URL</label>
      <input id="zm-url" type="text" bind:value={zordmindUrl} placeholder="https://inference.kube.megazord.studio" />
      <label for="zm-model">Model</label>
      <input id="zm-model" type="text" bind:value={zordmindModel} placeholder="qwen3-32b" />
    {/if}

    <div class="section-divider">API</div>

    <label>API Key <span class="hint">(required to trigger jobs remotely)</span></label>
    <div class="api-key-row">
      <input type="text" value={apiKey} readonly style="flex:1;font-family:monospace;font-size:0.75rem" />
      <button class="copy-btn" onclick={() => { navigator.clipboard.writeText(apiKey); copied = true; setTimeout(() => copied = false, 1500); }}>
        {copied ? '✓' : 'Copy'}
      </button>
    </div>

    <label for="webhook-url">Webhook URL <span class="hint">(called when a job finishes)</span></label>
    <input id="webhook-url" type="text" bind:value={webhookUrl} placeholder="https://hooks.zapier.com/..." />

    <button onclick={handleSave}>Save</button>
    {#if statusText}
      <div style="margin-top:0.5rem;font-size:0.8rem;color:{statusColor}">{statusText}</div>
    {/if}
  </div>
</div>

<style>
  .model-pair {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .hint {
    font-weight: normal;
    color: #999;
    font-size: 0.75em;
  }
  .section-divider {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    border-top: 1px solid #2a2a2a;
    padding-top: 0.75rem;
    margin: 0.75rem 0 0.5rem;
  }
  .api-key-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .copy-btn {
    all: unset;
    cursor: pointer;
    font-size: 0.75rem;
    color: #4caf50;
    border: 1px solid #2a3a2a;
    border-radius: 3px;
    padding: 0.2rem 0.5rem;
    white-space: nowrap;
  }
  .copy-btn:hover { color: #fff; border-color: #4caf50; }
</style>
