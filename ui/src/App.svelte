<script lang="ts">
  import Header from './components/Header.svelte';
  import MonitorScreen from './components/MonitorScreen.svelte';
  import DatasetsScreen from './components/DatasetsScreen.svelte';
  import EntitiesScreen from './components/EntitiesScreen.svelte';
  import SettingsModal from './components/modals/SettingsModal.svelte';
  import SchemaModal from './components/modals/SchemaModal.svelte';
  import { jobsStore } from './stores/jobs.svelte';
  import { dashStore } from './stores/dashboard.svelte';
  import { getSchemas, getOutputs, getSettings } from './lib/api';

  type Screen = 'monitor' | 'datasets' | 'entities';

  function parseHash(): { screen: Screen; entityKey?: string } {
    const raw = window.location.hash.slice(1);
    const [path, query] = raw.split('?');
    const params = new URLSearchParams(query ?? '');
    if (path === 'datasets') return { screen: 'datasets' };
    if (path === 'entities') return { screen: 'entities', entityKey: params.get('e') ?? undefined };
    return { screen: 'monitor' };
  }

  function navigate(s: Screen, entityKey?: string) {
    screen = s;
    if (s === 'entities' && entityKey) {
      window.location.hash = `entities?e=${encodeURIComponent(entityKey)}`;
      initialEntityKey = entityKey;
    } else {
      window.location.hash = s;
    }
  }

  const parsed = parseHash();
  let screen = $state<Screen>(parsed.screen);
  let initialEntityKey = $state<string | undefined>(parsed.entityKey);

  $effect(() => {
    function onHashChange() {
      const p = parseHash();
      screen = p.screen;
      if (p.entityKey) initialEntityKey = p.entityKey;
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  $effect(() => {
    if (dashStore.navTarget) {
      navigate('datasets');
      dashStore.navTarget = null;
    }
  });
  let settingsOpen = $state(false);
  let schemaModalOpen = $state(false);
  let editingSchemaId = $state<string | null>(null);

  let schemas = $state<Array<{ id: string; display_name: string }>>([]);
  let outputs = $state<string[]>([]);

  async function loadSelects() {
    const [schRes, outRes] = await Promise.all([getSchemas(), getOutputs()]);
    schemas = schRes.schemas;
    outputs = outRes.outputs;
  }

  $effect(() => {
    getSettings(); // loads api key into module-level store
    loadSelects();
    jobsStore.refresh();

    const interval = setInterval(() => {
      jobsStore.refresh();
      getOutputs().then(({ outputs: o }) => {
        if (o.length) outputs = o;
      });
    }, 3000);

    return () => clearInterval(interval);
  });
</script>

<Header
  {screen}
  onScreenChange={(s) => { navigate(s); }}
  onOpenSettings={() => { settingsOpen = true; }}
/>

<main class="app-content">
  {#if screen === 'monitor'}
    <div class="monitor-scroll">
      <MonitorScreen />
    </div>
  {:else if screen === 'datasets'}
    <DatasetsScreen
      {outputs}
      {schemas}
      onSchemaEdit={(id) => { editingSchemaId = id; schemaModalOpen = true; }}
      onNewSchema={() => { editingSchemaId = null; schemaModalOpen = true; }}
      onSelectsReload={loadSelects}
      onNavigateEntity={(key) => navigate('entities', key)}
    />
  {:else if screen === 'entities'}
    <EntitiesScreen initialKey={initialEntityKey} />
  {/if}
</main>

<SettingsModal open={settingsOpen} onClose={() => { settingsOpen = false; }} />
<SchemaModal
  open={schemaModalOpen}
  editingId={editingSchemaId}
  onClose={() => { schemaModalOpen = false; }}
  onSaved={loadSelects}
/>
