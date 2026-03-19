<script lang="ts">
  import { sendChat } from '../lib/api';

  const { jobId }: { jobId?: string } = $props();

  interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
  }

  let history = $state<ChatMessage[]>([]);
  let input = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let messagesEl = $state<HTMLElement | null>(null);

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    input = '';
    error = null;
    history = [...history, { role: 'user', content: msg }];
    loading = true;
    scrollToBottom();
    try {
      const res = await sendChat(msg, jobId, history.slice(0, -1));
      if (res.error) {
        error = res.error;
      } else {
        history = [...history, { role: 'assistant', content: res.reply ?? '' }];
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 20);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="chat-panel">
  <div class="chat-header">
    <span class="chat-header-icon">✦</span>
    <span class="chat-header-title">Scrappy Assistant</span>
    <span class="chat-header-hint">Ask about jobs, schemas, or datasets</span>
  </div>

  <div class="chat-messages" bind:this={messagesEl}>
    {#if history.length === 0 && !loading}
      <div class="chat-empty">
        <div class="chat-empty-icon">✦</div>
        <div class="chat-empty-text">Ask me anything about this job, your schemas, or extracted data.</div>
      </div>
    {/if}

    {#each history as msg}
      {#if msg.role === 'user'}
        <div class="chat-row user">
          <div class="chat-bubble user">{msg.content}</div>
        </div>
      {:else}
        <div class="chat-row assistant">
          <span class="chat-avatar">✦</span>
          <div class="chat-assistant-text">{msg.content}</div>
        </div>
      {/if}
    {/each}

    {#if loading}
      <div class="chat-row assistant">
        <span class="chat-avatar">✦</span>
        <span class="chat-thinking"><span></span><span></span><span></span></span>
      </div>
    {/if}

    {#if error}
      <div class="chat-error">{error}</div>
    {/if}
  </div>

  <div class="chat-input-wrap">
    <textarea
      class="chat-input"
      bind:value={input}
      onkeydown={handleKeydown}
      placeholder="Message Scrappy…"
      rows="1"
      disabled={loading}
    ></textarea>
    <button class="chat-send" onclick={send} disabled={loading || !input.trim()} title="Send (Enter)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .chat-panel {
    border: 1px solid #222;
    border-radius: 8px;
    background: #0d1117;
    display: flex;
    flex-direction: column;
    font-family: "IBM Plex Mono", monospace;
    overflow: hidden;
    min-height: 0;
  }

  /* Header */
  .chat-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid #1e2530;
    background: #0a0e14;
    flex-shrink: 0;
  }
  .chat-header-icon {
    color: #22d3ee;
    font-size: 0.7rem;
    flex-shrink: 0;
  }
  .chat-header-title {
    font-size: 0.72rem;
    font-weight: 700;
    color: #c8d0da;
    letter-spacing: 0.03em;
  }
  .chat-header-hint {
    font-size: 0.67rem;
    color: #4a5a6a;
    margin-left: 0.25rem;
  }

  /* Messages */
  .chat-messages {
    flex: 1;
    min-height: 120px;
    max-height: 280px;
    overflow-y: auto;
    padding: 0.85rem 0.9rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    scrollbar-width: thin;
    scrollbar-color: #1e2530 transparent;
  }

  /* Empty state */
  .chat-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    height: 100%;
    min-height: 80px;
    opacity: 0.5;
  }
  .chat-empty-icon {
    font-size: 1.4rem;
    color: #22d3ee;
    opacity: 0.4;
  }
  .chat-empty-text {
    font-size: 0.72rem;
    color: #8a9ab0;
    text-align: center;
    max-width: 280px;
    line-height: 1.6;
  }

  /* Message rows */
  .chat-row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .chat-row.user {
    justify-content: flex-end;
  }
  .chat-row.assistant {
    justify-content: flex-start;
  }

  /* User bubble */
  .chat-bubble.user {
    background: #162535;
    border: 1px solid #1e3a50;
    color: #dde8f0;
    font-size: 0.78rem;
    line-height: 1.6;
    padding: 0.5rem 0.85rem;
    border-radius: 14px 14px 3px 14px;
    max-width: 80%;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Assistant */
  .chat-avatar {
    color: #22d3ee;
    font-size: 0.72rem;
    flex-shrink: 0;
    margin-top: 0.22rem;
    opacity: 0.8;
  }
  .chat-assistant-text {
    font-size: 0.78rem;
    line-height: 1.7;
    color: #c8d4e0;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 90%;
    flex: 1;
    min-width: 0;
  }

  /* Thinking dots */
  .chat-thinking {
    display: flex;
    gap: 4px;
    align-items: center;
    padding-top: 0.22rem;
  }
  .chat-thinking span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #22d3ee;
    opacity: 0.4;
    animation: dot-pulse 1.2s ease-in-out infinite;
  }
  .chat-thinking span:nth-child(2) { animation-delay: 0.2s; }
  .chat-thinking span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes dot-pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.1); }
  }

  .chat-error {
    font-size: 0.72rem;
    color: #f87171;
    background: #1a0a0a;
    border: 1px solid #3a1a1a;
    border-radius: 6px;
    padding: 0.4rem 0.65rem;
  }

  /* Input */
  .chat-input-wrap {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid #1a2030;
    background: #0a0e14;
  }

  .chat-input {
    flex: 1;
    background: #111820;
    border: 1px solid #253040;
    border-radius: 8px;
    outline: none;
    color: #dde8f0;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.78rem;
    line-height: 1.5;
    padding: 0.5rem 0.75rem;
    resize: none;
    margin: 0;
    min-height: unset;
    max-height: 120px;
    overflow-y: auto;
    scrollbar-width: none;
    transition: border-color 0.15s;
  }
  .chat-input::placeholder { color: #3a4a5a; }
  .chat-input:focus { border-color: #2a4a60; }
  .chat-input:disabled { opacity: 0.5; }

  .chat-send {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #22d3ee;
    color: #000;
    flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
    margin-bottom: 1px;
  }
  .chat-send:not(:disabled):hover { background: #38e8ff; }
  .chat-send:disabled {
    background: #1a2530;
    color: #3a5060;
    cursor: not-allowed;
  }
</style>
