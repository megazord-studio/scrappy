<script lang="ts">
  type Screen = 'discovery' | 'monitor' | 'schemas' | 'sources' | 'history' | 'extractions';

  const {
    screen,
    navCollapsed = false,
    onOpenSettings,
  }: {
    screen: Screen;
    navCollapsed?: boolean;
    onOpenSettings: () => void;
  } = $props();

  const screenLabels: Record<Screen, string> = {
    discovery:   'Discovery',
    monitor:     'Monitor',
    schemas:     'Schemas',
    sources:     'Sources',
    history:     'History',
    extractions: 'Extractions',
  };

  import { authStore } from '../stores/auth.svelte';

  let isLight = $state(document.documentElement.dataset.theme === 'light');

  function toggleTheme() {
    isLight = !isLight;
    const theme = isLight ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('scrappy-theme', theme);
  }
</script>

<header class="topbar">
  <!-- Brand zone (aligned with nav rail) -->
  <div class="brand-zone" style="width: {navCollapsed ? 56 : 256}px">
    <span class="brand-name">Scrappy</span>
  </div>

  <!-- Main zone (breadcrumb) -->
  <div class="main-zone">
    <div class="breadcrumb">
      <span class="bc-root">Data Engine</span>
      <span class="bc-sep">›</span>
      <span class="bc-current">{screenLabels[screen]}</span>
    </div>
  </div>

  <!-- Actions -->
  <div class="actions">
    <button class="action-btn" onclick={toggleTheme} title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}>
      <span class="msicon">{isLight ? 'dark_mode' : 'light_mode'}</span>
    </button>
    <button class="action-btn" onclick={onOpenSettings} title="Settings">
      <span class="msicon">settings</span>
    </button>
    <div class="node-badge">
      <span class="node-dot"></span>
      <span class="node-label">Node Online</span>
    </div>

    {#if authStore.user}
      <div class="user-badge">
        <span class="msicon user-icon">person</span>
        <span class="user-email">{authStore.user.email}</span>
        {#if authStore.isAdmin}
          <span class="role-chip">admin</span>
        {/if}
      </div>
      <button class="action-btn" onclick={() => authStore.signOut()} title="Sign out">
        <span class="msicon">logout</span>
      </button>
    {/if}
  </div>
</header>

<style>
  .topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    z-index: 60;
    display: flex;
    align-items: center;
    background: var(--surface-container-low);
    background-image: radial-gradient(circle at 2px 2px, rgba(228, 190, 178, 0.07) 1px, transparent 0);
    background-size: 24px 24px;
    background-attachment: fixed;
    border-bottom: 1px solid var(--c-border-light);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  /* Left zone: same width as nav rail */
  .brand-zone {
    flex-shrink: 0;
    padding: 0 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: width 0.2s ease;
  }
  .brand-name {
    font-family: 'Inter', sans-serif;
    font-size: 0.9rem;
    font-weight: 900;
    color: var(--on-surface);
    letter-spacing: -0.03em;
    text-transform: uppercase;
  }

  /* Main zone: breadcrumb */
  .main-zone {
    flex: 1;
    padding: 0 1.5rem;
    min-width: 0;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .bc-root {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }
  .bc-sep {
    font-size: 0.65rem;
    color: var(--on-surface-muted);
    opacity: 0.5;
  }
  .bc-current {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primary-container);
  }

  /* Right actions */
  .actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 1rem;
    flex-shrink: 0;
  }
  .action-btn {
    all: unset;
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--on-surface-muted);
    transition: color 0.15s, background 0.15s;
    border-radius: 2px;
  }
  .action-btn:hover {
    color: var(--primary-container);
    background: var(--surface-container);
  }
  .action-btn .msicon {
    font-size: 18px;
  }

  .node-badge {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: 0.5rem;
    padding: 0.25rem 0.65rem;
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
  }
  .node-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #22c55e;
    flex-shrink: 0;
    animation: pulse-green 2.5s ease-in-out infinite;
  }
  @keyframes pulse-green {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .node-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
  }

  .user-badge {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: 0.25rem;
    padding: 0.25rem 0.65rem;
    background: var(--surface-container);
    border: 1px solid var(--c-border-light);
    max-width: 200px;
    overflow: hidden;
  }
  .user-icon {
    font-size: 14px !important;
    color: var(--on-surface-muted);
    flex-shrink: 0;
  }
  .user-email {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    color: var(--on-surface-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .role-chip {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--primary-container);
    background: rgba(255,89,10,0.1);
    border: 1px solid rgba(255,89,10,0.2);
    padding: 0.1rem 0.35rem;
    border-radius: 2px;
    flex-shrink: 0;
  }
</style>
