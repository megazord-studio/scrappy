<script lang="ts">
  const {
    title,
    count,
    color = '#22d3ee',
    children,
  }: {
    title: string;
    count: number | string;
    color?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<div class="dash-panel" style="--panel-color: {color}">
  <div class="dash-panel-header">
    <span class="dash-panel-title">{title}</span>
    <span class="dash-panel-count">{count}</span>
  </div>
  <div class="dash-panel-body">
    {@render children()}
  </div>
</div>
