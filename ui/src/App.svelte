<script lang="ts">
  import Header from './components/Header.svelte';
  import MonitorScreen from './components/MonitorScreen.svelte';
  import ScrapeScreen from './components/ScrapeScreen.svelte';
  import DatasetsScreen from './components/DatasetsScreen.svelte';
  import SettingsModal from './components/modals/SettingsModal.svelte';
  import SchemaModal from './components/modals/SchemaModal.svelte';
  import { jobsStore } from './stores/jobs.svelte';
  import { dashStore } from './stores/dashboard.svelte';
  import { getSchemas, getOutputs, getSettings } from './lib/api';

  let screen = $state<'monitor' | 'scrape' | 'datasets'>('monitor');
  let scrapeInitialDataset = $state<string | null>(null);

  $effect(() => {
    if (dashStore.navTarget) {
      scrapeInitialDataset = dashStore.navTarget;
      screen = 'scrape';
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
  onScreenChange={(s) => { screen = s; }}
  onOpenSettings={() => { settingsOpen = true; }}
/>

{#if screen === 'monitor'}
  <MonitorScreen />
{:else if screen === 'datasets'}
  <DatasetsScreen {outputs} {schemas} />
{:else}
  <ScrapeScreen
    {schemas}
    {outputs}
    initialDataset={scrapeInitialDataset}
    onSchemaEdit={(id) => { editingSchemaId = id; schemaModalOpen = true; }}
    onNewSchema={() => { editingSchemaId = null; schemaModalOpen = true; }}
    onSelectsReload={loadSelects}
  />
{/if}

<SettingsModal open={settingsOpen} onClose={() => { settingsOpen = false; }} />
<SchemaModal
  open={schemaModalOpen}
  editingId={editingSchemaId}
  onClose={() => { schemaModalOpen = false; }}
  onSaved={loadSelects}
/>
