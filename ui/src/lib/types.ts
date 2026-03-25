export interface Job {
  id: string;
  type: 'index' | 'update';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  params: {
    topic?: string;
    schema?: string;
    output?: string;
    input?: string;
    filter?: string;
    maxIterations?: number;
  };
  result?: string;
}

export interface ScrapeEntry {
  url: string;
  depth?: number;
  ts: string;
}

export interface CompletedScrape {
  url: string;
  chars?: number;
  links?: number;
  ts: string;
}

export interface SearchEntry {
  query: string;
  count: number | null;
  ts: string;
}

export interface ExtractionEntry {
  url: string;
  count: number;
  total: number;
  ts: string;
}

export interface ErrorEntry {
  tool?: string;
  message: string;
  ts: string;
}

export interface UpdateRow {
  provider: string;
  url?: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
  ts: string;
  dataset?: string;
}

export interface LogEntry {
  type: string;
  text: string;
}

export interface DashboardState {
  job: Job | null;
  iteration: number;
  maxIterations: number;
  visitedCount: number;
  recordCount: number;
  activeScrapes: Map<string, ScrapeEntry>;
  completedScrapes: CompletedScrape[];
  searches: SearchEntry[];
  extractions: ExtractionEntry[];
  errors: ErrorEntry[];
  rawLog: LogEntry[];
  updateTotal: number;
  updateDone: number;
  updateRows: UpdateRow[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface Schema {
  id: string;
  display_name: string;
  fields: SchemaField[];
  /** JSON-encoded string[] */
  dedupe_key: string;
  url_field: string;
  /** JSON-encoded string[] */
  rate_fields: string;
  /** JSON-encoded string[] */
  naming_rules?: string;
  entity_field?: string;
}

export interface Entity {
  id: number | null;
  normalized_name: string;
  display_name: string;
  description: string | null;
  logo_url: string | null;
  external_url: string | null;
  record_count: number;
  datasets: string[];
}

export interface EntityDataset {
  dataset: string;
  schema_id: string | null;
  records: Record<string, string>[];
}

export interface SchemaField {
  name: string;
  type: string;
  optional: boolean;
  description: string;
}

export interface Settings {
  llmProvider?: string;
  anthropicAgentModel?: string;
  anthropicExtractModel?: string;
  openaiModel?: string;
  openaiExtractModel?: string;
  zordmindUrl?: string;
  zordmindModel?: string;
  crawl4aiBase?: string;
  apiKey?: string;
  webhookUrl?: string;
}

export interface RecordsResponse {
  headers: string[];
  rows: Record<string, string>[];
}
