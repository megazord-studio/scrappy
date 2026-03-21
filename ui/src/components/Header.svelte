<script lang="ts">
  import { jobsStore } from '../stores/jobs.svelte';
  import BotIcon from './BotIcon.svelte';

  const {
    screen,
    theme = 'dark',
    onScreenChange,
    onOpenSettings,
  }: {
    screen: 'monitor' | 'datasets';
    theme?: 'dark' | 'light';
    onScreenChange: (s: 'monitor' | 'datasets') => void;
    onOpenSettings: () => void;
  } = $props();

  const runningJob = $derived(jobsStore.jobs.find(j => j.status === 'running'));
  const runningLabel = $derived(
    runningJob
      ? runningJob.type === 'index'
        ? (runningJob.params.topic ?? 'index')
        : `update: ${runningJob.params.input ?? ''}`
      : null
  );
</script>

<div class="app-header" class:app-header--light={theme === 'light'}>
  <div style="display:flex;align-items:center;gap:1.5rem">
    <div class="brand">
      <BotIcon size={18} color="#00bcd4" strokeWidth={1.75} />
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
    color: #aaa;
    text-decoration: underline;
    text-underline-offset: 3px;
    font-family: monospace;
    transition: color 0.15s;
  }
  .docs-link:hover { color: #fff; }

  .app-nav {
    display: flex;
    gap: 0.1rem;
  }
  .nav-link {
    all: unset;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    color: #888;
    padding: 0.25rem 0.65rem;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .nav-link:hover { color: #aaa; background: #1a1a1a; }
  .nav-link.active { color: #00bcd4; background: #0a2a2a; }

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
    background: #4caf50;
    box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.5);
    animation: pulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.5); }
    70%  { box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); }
    100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); }
  }
  .running-label {
    font-size: 0.72rem;
    color: #4caf50;
    font-family: monospace;
    max-width: 260px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Light theme (Datasets screen) */
  .app-header--light {
    background: #f5f3ee;
    border-bottom-color: #dddbd5;
  }
  .app-header--light :global(h1) { color: #0e0d0b; }
  .app-header--light .nav-link { color: #6b6860; }
  .app-header--light .nav-link:hover { color: #0e0d0b; background: #ece9e3; }
  .app-header--light .nav-link.active { color: #0e7490; background: #cffafe; }
  .app-header--light .docs-link { color: #9b9892; }
  .app-header--light .docs-link:hover { color: #0e0d0b; }
  .app-header--light .gear-btn { color: #6b6860; }
  .app-header--light .gear-btn:hover { color: #0e0d0b; }
  .app-header--light .running-label { color: #16a34a; }
</style>
