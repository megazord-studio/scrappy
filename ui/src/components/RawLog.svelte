<script lang="ts">
  import type { LogEntry } from '../lib/types';
  import { classifyType } from '../lib/events';

  const { entries }: { entries: LogEntry[] } = $props();

  let open = $state(false);
  let bodyEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (open && bodyEl) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  });
</script>

<div class="raw-log-wrap">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="raw-log-header" onclick={() => { open = !open; }}>
    <span class="raw-log-toggle">Raw Log ({entries.length})</span>
    <span class="raw-log-chevron" class:open>›</span>
  </div>
  {#if open}
    <div class="raw-log-body" bind:this={bodyEl}>
      {#each entries as entry}
        <div class="log-line {classifyType(entry.type)}">{entry.text}</div>
      {/each}
    </div>
  {/if}
</div>
