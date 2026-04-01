<script lang="ts">
  import { jobsStore } from '../stores/jobs.svelte';

  type Screen = 'discovery' | 'monitor' | 'schemas' | 'sources' | 'history' | 'extractions';

  const {
    screen,
    navCollapsed,
    onNavigate,
    onToggleNav,
    onOpenSettings,
  }: {
    screen: Screen;
    navCollapsed: boolean;
    onNavigate: (s: Screen) => void;
    onToggleNav: () => void;
    onOpenSettings: () => void;
  } = $props();

  const runningJob = $derived(jobsStore.jobs.find(j => j.status === 'running'));

  const navItems: { id: Screen; icon: string; label: string }[] = [
    { id: 'discovery',   icon: 'search_insights', label: 'Discovery'   },
    { id: 'monitor',     icon: 'monitor_heart',   label: 'Monitor'     },
    { id: 'extractions', icon: 'dataset',          label: 'Extractions' },
    { id: 'schemas',     icon: 'schema',           label: 'Schemas'     },
    { id: 'sources',     icon: 'database',         label: 'Sources'     },
    { id: 'history',     icon: 'history',          label: 'History'     },
  ];
</script>

<aside class="rail" class:collapsed={navCollapsed}>
  <nav class="nav">
    {#if !navCollapsed}
      <span class="nav-group-label">Core Engine</span>
    {/if}
    {#each navItems as item}
      <button
        class="nav-item"
        class:active={screen === item.id}
        onclick={() => onNavigate(item.id)}
        title={navCollapsed ? item.label : undefined}
      >
        <span class="msicon">{item.icon}</span>
        {#if !navCollapsed}
          <span class="nav-label">{item.label}</span>
          {#if item.id === 'history' && runningJob}
            <span class="running-dot"></span>
          {/if}
        {:else if item.id === 'history' && runningJob}
          <span class="running-dot running-dot--abs"></span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="bottom">
    {#if !navCollapsed}
      <button class="new-btn" onclick={() => onNavigate('discovery')}>
        <span class="msicon" style="font-size:16px">add</span>
        New Extraction
      </button>
    {:else}
      <button class="new-btn new-btn--icon" onclick={() => onNavigate('discovery')} title="New Extraction">
        <span class="msicon" style="font-size:18px">add</span>
      </button>
    {/if}
    <div class="bottom-links">
      <button class="bottom-link" onclick={onOpenSettings} title={navCollapsed ? 'Settings' : undefined}>
        <span class="msicon" style="font-size:18px">settings</span>
        {#if !navCollapsed}<span>Settings</span>{/if}
      </button>
      <button class="bottom-link toggle-btn" onclick={onToggleNav} title={navCollapsed ? 'Expand' : 'Collapse'}>
        <span class="msicon" style="font-size:18px">{navCollapsed ? 'chevron_right' : 'chevron_left'}</span>
        {#if !navCollapsed}<span>Collapse</span>{/if}
      </button>
    </div>
  </div>
</aside>

<style>
  .rail {
    position: fixed;
    top: 48px;
    bottom: 0;
    left: 0;
    width: 256px;
    background: var(--surface-container-high);
    border-right: 1px solid var(--c-border-light);
    box-shadow: 32px 0 64px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    z-index: 50;
    overflow: hidden;
    transition: width 0.2s ease;
  }
  .rail.collapsed { width: 56px; }

  .nav {
    flex: 1;
    padding: 1rem 0.5rem 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .nav-group-label {
    display: block;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    padding: 0 0.75rem 0.5rem;
    margin-bottom: 0.25rem;
    white-space: nowrap;
  }
  .nav-item {
    all: unset;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0.9rem;
    cursor: pointer;
    color: var(--on-surface-muted);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 2px;
    transition: color 0.15s, background 0.15s;
    position: relative;
    width: 100%;
    box-sizing: border-box;
    white-space: nowrap;
  }
  .rail.collapsed .nav-item {
    padding: 0.75rem;
    justify-content: center;
    gap: 0;
  }
  .nav-item:hover {
    color: var(--on-surface);
    background: var(--surface-container);
  }
  .nav-item.active {
    color: var(--primary-container);
    background: var(--surface-container-highest);
    border-left: 2px solid var(--primary-container);
    padding-left: calc(0.9rem - 2px);
  }
  .rail.collapsed .nav-item.active {
    border-left: 2px solid var(--primary-container);
    padding-left: calc(0.75rem - 2px);
  }
  .nav-label { flex: 1; }

  .running-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--primary-container);
    flex-shrink: 0;
    animation: blink 1.4s ease-in-out infinite;
  }
  .running-dot--abs {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 5px;
    height: 5px;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  .bottom {
    flex-shrink: 0;
    padding: 0.75rem 0.5rem 1.25rem;
    border-top: 1px solid var(--c-border-light);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .new-btn {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    background: var(--primary-container);
    color: var(--on-primary-fixed);
    padding: 0.65rem 1rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    transition: opacity 0.15s, box-shadow 0.15s;
    white-space: nowrap;
  }
  .new-btn:hover {
    opacity: 0.92;
    box-shadow: 0 0 18px rgba(255, 89, 10, 0.3);
  }
  .new-btn--icon { padding: 0.65rem; }

  .bottom-links { display: flex; flex-direction: column; gap: 1px; }
  .bottom-link {
    all: unset;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    color: var(--on-surface-muted);
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 2px;
    transition: color 0.15s;
    width: 100%;
    box-sizing: border-box;
    white-space: nowrap;
  }
  .rail.collapsed .bottom-link { justify-content: center; padding: 0.5rem; gap: 0; }
  .bottom-link:hover { color: var(--on-surface); }
  .toggle-btn { opacity: 0.5; }
  .toggle-btn:hover { opacity: 1; }
</style>
