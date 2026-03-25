<script lang="ts">
  import { jobsStore } from '../stores/jobs.svelte';
  import BotIcon from './BotIcon.svelte';
  import { getJobLabel } from '../lib/format';

  const {
    screen,
    onScreenChange,
    onOpenSettings,
  }: {
    screen: 'monitor' | 'datasets';
    onScreenChange: (s: 'monitor' | 'datasets') => void;
    onOpenSettings: () => void;
  } = $props();

  const runningJob = $derived(jobsStore.jobs.find(j => j.status === 'running'));
  const runningLabel = $derived(runningJob ? getJobLabel(runningJob) : null);
</script>

<div class="app-header">
  <div style="display:flex;align-items:center;gap:1.5rem">
    <div class="brand">
      <BotIcon size={18} color="#22d3ee" strokeWidth={1.75} />
      <h1>scrappy</h1>
    </div>
    <nav class="app-nav">
      <button class="nav-link" class:active={screen === 'monitor'} onclick={() => onScreenChange('monitor')}>Monitor</button>
      <button class="nav-link" class:active={screen === 'datasets'} onclick={() => onScreenChange('datasets')}>Datasets</button>
    </nav>
    {#if runningLabel}
      <div class="running-indicator" title={runningLabel}>
        <span class="pulse"></span>
        <span class="running-label">{runningLabel}</span>
      </div>
    {/if}
  </div>
  <div style="display:flex;align-items:center;gap:1rem">
    <a class="docs-link" href={`${window.location.protocol}//docs.${window.location.hostname}`} target="_blank" rel="noopener" title="Documentation">docs</a>
    <button class="gear-btn" title="Settings" onclick={onOpenSettings}>⚙</button>
  </div>
</div>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .docs-link {
    font-size: 0.8rem;
    color: #9b9892;
    text-decoration: underline;
    text-underline-offset: 3px;
    font-family: monospace;
    transition: color 0.15s;
  }
  .docs-link:hover { color: #0e0d0b; }

  .app-nav {
    display: flex;
    gap: 0.1rem;
  }
  .nav-link {
    all: unset;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    color: #6b6860;
    padding: 0.25rem 0.65rem;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .nav-link:hover { color: #0e0d0b; background: #ece9e3; }
  .nav-link.active { color: #0e7490; background: #ecfeff; }

  .running-indicator {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .pulse {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #16a34a;
    box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5);
    animation: pulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5); }
    70%  { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
    100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
  }
  .running-label {
    font-size: 0.72rem;
    color: #16a34a;
    font-family: monospace;
    max-width: 260px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
