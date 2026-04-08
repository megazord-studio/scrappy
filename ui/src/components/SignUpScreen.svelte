<script lang="ts">
  import { authStore } from '../stores/auth.svelte';

  const {
    onSuccess,
    onSwitchToSignIn,
  }: {
    onSuccess: () => void;
    onSwitchToSignIn: () => void;
  } = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (password.length < 8) { error = 'Password must be at least 8 characters'; return; }
    loading = true;
    error = '';
    try {
      await authStore.signUp(name, email, password);
      onSuccess();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Sign up failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="auth-shell">
  <div class="auth-card">
    <div class="brand">
      <span class="brand-dot"></span>
      Scrappy
    </div>

    <h1 class="auth-title">Create account</h1>
    <p class="auth-subtitle">Start extracting data in minutes</p>

    <form onsubmit={submit}>
      <div class="field">
        <label for="su-name">Full name</label>
        <input
          id="su-name"
          type="text"
          bind:value={name}
          placeholder="Jane Smith"
          autocomplete="name"
          required
          disabled={loading}
        />
      </div>
      <div class="field">
        <label for="su-email">Work email</label>
        <input
          id="su-email"
          type="email"
          bind:value={email}
          placeholder="you@company.com"
          autocomplete="email"
          required
          disabled={loading}
        />
      </div>
      <div class="field">
        <label for="su-password">Password</label>
        <input
          id="su-password"
          type="password"
          bind:value={password}
          placeholder="••••••••"
          autocomplete="new-password"
          required
          disabled={loading}
        />
        <span class="field-hint">At least 8 characters</span>
      </div>

      {#if error}
        <p class="auth-error">{error}</p>
      {/if}

      <button type="submit" disabled={loading} class="auth-btn">
        {#if loading}
          <span class="spinner"></span>Creating account…
        {:else}
          Create Account <span class="msicon">arrow_forward</span>
        {/if}
      </button>
    </form>

    <p class="terms">
      By signing up you agree to our
      <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
    </p>

    <div class="auth-divider"></div>

    <p class="auth-switch">
      Already have an account?
      <button type="button" onclick={onSwitchToSignIn} class="link-btn">Sign in</button>
    </p>
  </div>
</div>

<style>
  .auth-shell {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--surface);
    background-image: radial-gradient(circle at 2px 2px, rgba(228,190,178,0.07) 1px, transparent 0);
    background-size: 24px 24px;
    z-index: 200;
  }

  .auth-card {
    width: 100%;
    max-width: 360px;
    background: var(--surface-container);
    border: 1px solid var(--c-border);
    border-radius: 4px;
    padding: 2rem;
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

  .auth-title {
    font-size: 1.3rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--on-surface);
    margin-bottom: 0.3rem;
  }
  .auth-subtitle {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--on-surface-muted);
    margin-bottom: 1.75rem;
  }

  .field { margin-bottom: 0.9rem; }
  .field-hint {
    font-size: 0.6rem;
    color: var(--on-surface-muted);
    margin-top: 0.25rem;
    display: block;
  }

  .auth-error {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--error);
    margin-bottom: 0.75rem;
  }

  .auth-btn {
    width: 100%;
    margin-top: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.65rem 1rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .auth-btn .msicon { font-size: 16px; }

  .terms {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    color: var(--on-surface-muted);
    margin-top: 0.9rem;
    text-align: center;
    line-height: 1.6;
  }
  .terms a { color: var(--primary-container); text-decoration: none; }
  .terms a:hover { text-decoration: underline; }

  .auth-divider {
    height: 1px;
    background: var(--c-border);
    margin: 1.5rem 0;
  }

  .auth-switch {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface-muted);
    text-align: center;
  }

  .link-btn {
    all: unset;
    cursor: pointer;
    color: var(--primary-container);
    font-weight: 700;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .link-btn:hover { text-decoration: underline; }
</style>
