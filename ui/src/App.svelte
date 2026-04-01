<script lang="ts">
  import NavRail from './components/NavRail.svelte';
  import TopBar from './components/TopBar.svelte';
  import DiscoveryScreen from './components/DiscoveryScreen.svelte';
  import SourcesScreen from './components/SourcesScreen.svelte';
  import HistoryScreen from './components/HistoryScreen.svelte';
  import SchemasScreen from './components/SchemasScreen.svelte';
  import ExtractionsScreen from './components/ExtractionsScreen.svelte';
  import MonitorScreen from './components/MonitorScreen.svelte';
  import SettingsModal from './components/modals/SettingsModal.svelte';
  import SchemaModal from './components/modals/SchemaModal.svelte';
  import { jobsStore } from './stores/jobs.svelte';
  import { dashStore } from './stores/dashboard.svelte';
  import { getSchemas, getOutputs, getSettings } from './lib/api';
  import type { Schema } from './lib/types';

  // Initialize theme before first render
  const savedTheme = localStorage.getItem('scrappy-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.dataset.theme = savedTheme;
  }

  type Screen = 'discovery' | 'monitor' | 'schemas' | 'sources' | 'history' | 'extractions';

  function parseHash(): Screen {
    const raw = window.location.hash.slice(1).split('?')[0];
    if (raw === 'history')     return 'history';
    if (raw === 'schemas')     return 'schemas';
    if (raw === 'sources')     return 'sources';
    if (raw === 'extractions') return 'extractions';
    if (raw === 'monitor')     return 'monitor';
    return 'discovery';
  }

  function navigate(s: Screen) {
    screen = s;
    window.location.hash = s;
  }

  function openExtraction(output: string) {
    selectedOutput = output;
    navigate('extractions');
  }

  let screen = $state<Screen>(parseHash());
  let selectedOutput = $state<string | null>(null);

  // Nav collapse state
  let navCollapsed = $state(localStorage.getItem('scrappy-nav') === 'collapsed');
  const navWidth = $derived(navCollapsed ? 56 : 256);

  function toggleNav() {
    navCollapsed = !navCollapsed;
    localStorage.setItem('scrappy-nav', navCollapsed ? 'collapsed' : 'expanded');
  }

  $effect(() => {
    function onHashChange() { screen = parseHash(); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  $effect(() => {
    if (dashStore.navTarget) {
      navigate('history');
      dashStore.navTarget = null;
    }
  });

  let settingsOpen = $state(false);
  let schemaModalOpen = $state(false);
  let editingSchemaId = $state<string | null>(null);

  let schemas = $state<Schema[]>([]);
  let outputs = $state<string[]>([]);

  async function loadSelects() {
    const [schRes, outRes] = await Promise.all([getSchemas(), getOutputs()]);
    schemas = schRes.schemas;
    outputs = outRes.outputs;
  }

  $effect(() => {
    getSettings();
    loadSelects();
    jobsStore.refresh();

    const interval = setInterval(() => {
      jobsStore.refresh();
      getOutputs().then(({ outputs: o }) => { if (o.length) outputs = o; });
    }, 3000);

    return () => clearInterval(interval);
  });
</script>

<TopBar
  {screen}
  {navCollapsed}
  onOpenSettings={() => { settingsOpen = true; }}
/>

<div class="app-shell" style="--nav-w: {navWidth}px">
  <NavRail
    {screen}
    {navCollapsed}
    onNavigate={navigate}
    onToggleNav={toggleNav}
    onOpenSettings={() => { settingsOpen = true; }}
  />

  <div class="app-main">
    <div class="app-content">
      {#if screen === 'discovery'}
        <DiscoveryScreen onNavigate={navigate} />
      {:else if screen === 'monitor'}
        <MonitorScreen />
      {:else if screen === 'history'}
        <HistoryScreen onOpenExtraction={openExtraction} />
      {:else if screen === 'extractions'}
        <ExtractionsScreen
          {outputs}
          {selectedOutput}
          onSelectOutput={(o) => { selectedOutput = o; }}
          onDeleted={(o) => { outputs = outputs.filter(x => x !== o); if (selectedOutput === o) selectedOutput = null; }}
        />
      {:else if screen === 'schemas'}
        <SchemasScreen
          onNewSchema={() => { editingSchemaId = null; schemaModalOpen = true; }}
          onSelectsReload={loadSelects}
        />
      {:else if screen === 'sources'}
        <SourcesScreen />
      {/if}
    </div>
  </div>
</div>

<SettingsModal open={settingsOpen} onClose={() => { settingsOpen = false; }} />
<SchemaModal
  open={schemaModalOpen}
  editingId={editingSchemaId}
  onClose={() => { schemaModalOpen = false; }}
  onSaved={loadSelects}
/>
