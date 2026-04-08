<script lang="ts">
  import { authStore } from '../stores/auth.svelte';
</script>

<div class="waiting-shell">
  <div class="waiting-card">

    <div class="brand">
      <span class="brand-dot"></span>
      Scrappy
    </div>

    <div class="badge-row">
      <span class="status-badge">
        <span class="status-dot"></span>
        Trial coming soon
      </span>
    </div>

    <h1 class="title">You're on the list.</h1>
    <p class="body">
      We're finalising the hosted trial. You'll get an email the moment it's
      ready — no action needed on your end.
    </p>
    <p class="body">
      Want an early preview or have a use case to share?
      <a href="mailto:info@megazord.studio" class="link">Write to us</a> — we read every message.
    </p>

    <div class="divider"></div>

    <div class="user-row">
      <span class="msicon user-icon">person</span>
      <span class="user-email">{authStore.user?.email}</span>
      <button class="signout-btn" onclick={() => authStore.signOut()}>
        <span class="msicon">logout</span>
        Sign out
      </button>
    </div>

  </div>
</div>

<style>
  .waiting-shell {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--surface);
    background-image: radial-gradient(circle at 2px 2px, rgba(228,190,178,0.07) 1px, transparent 0);
    background-size: 24px 24px;
  }

  .waiting-card {
    width: 100%;
    max-width: 440px;
    background: var(--surface-container);
    border: 1px solid var(--c-border);
    border-radius: 4px;
    padding: 2.25rem;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--primary-container);
    margin-bottom: 1.75rem;
    font-family: 'Inter', sans-serif;
  }
  .brand-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--primary-container);
    flex-shrink: 0;
  }

  .badge-row {
    margin-bottom: 1.25rem;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--primary-container);
    background: rgba(255,89,10,0.08);
    border: 1px solid rgba(255,89,10,0.2);
    padding: 0.3rem 0.7rem;
    border-radius: 2px;
  }
  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--primary-container);
    animation: pulse-orange 1.6s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse-orange {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .title {
    font-size: 1.6rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--on-surface);
    margin-bottom: 1rem;
  }

  .body {
    font-size: 0.875rem;
    line-height: 1.75;
    color: var(--on-surface-muted);
    margin-bottom: 0.85rem;
  }
  .body:last-of-type { margin-bottom: 0; }

  .link {
    color: var(--primary-container);
    text-decoration: none;
    font-weight: 600;
  }
  .link:hover { text-decoration: underline; }

  .divider {
    height: 1px;
    background: var(--c-border);
    margin: 1.75rem 0 1.25rem;
  }

  .user-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .user-icon {
    font-size: 15px !important;
    color: var(--on-surface-muted);
    flex-shrink: 0;
  }
  .user-email {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.04em;
    color: var(--on-surface-muted);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .signout-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface-muted);
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .signout-btn:hover { color: var(--on-surface); }
  .signout-btn .msicon { font-size: 14px !important; }
</style>
