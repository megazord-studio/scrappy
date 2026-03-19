import type { DashboardState } from '../lib/types';
import { getJob, getJobEvents } from '../lib/api';
import { formatEvent } from '../lib/events';
import { jobsStore } from './jobs.svelte';

function defaultState(): DashboardState {
  return {
    job: null,
    iteration: 0,
    maxIterations: 40,
    visitedCount: 0,
    recordCount: 0,
    activeScrapes: new Map(),
    completedScrapes: [],
    searches: [],
    extractions: [],
    errors: [],
    rawLog: [],
    updateTotal: 0,
    updateDone: 0,
    updateRows: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
}

class DashboardStore {
  state = $state<DashboardState>(defaultState());
  jobStartedAt = $state<Date | null>(null);
  activeRpTab = $state<'monitor' | 'records'>('monitor');
  recordsFile = $state<string | null>(null);
  recordsRefreshTick = $state(0);
  currentAction = $state<string>('waiting for your input');
  navTarget = $state<string | null>(null);

  private activeStream: EventSource | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private recordsTimer: ReturnType<typeof setInterval> | null = null;

  elapsed = $derived(
    this.jobStartedAt ? Math.floor((Date.now() - this.jobStartedAt.getTime()) / 1000) : null
  );

  async openJob(id: string) {
    jobsStore.select(id);
    await jobsStore.refresh();

    if (this.activeStream) { this.activeStream.close(); this.activeStream = null; }
    if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
    if (this.recordsTimer) { clearInterval(this.recordsTimer); this.recordsTimer = null; }

    this.state = defaultState();
    this.activeRpTab = 'monitor';
    this.recordsFile = null;
    this.currentAction = 'waiting for your input';

    const job = await getJob(id);
    this.state.job = job;
    this.jobStartedAt = new Date(job.startedAt);
    this.recordsFile = job.params.output ?? null;

    const { events } = await getJobEvents(id);
    for (const e of events) {
      this.processEvent(e.type, e.payload, e.ts);
    }

    if (job.status === 'running') {
      this.elapsedTimer = setInterval(() => {
        // trigger reactivity by touching jobStartedAt
        // The $derived elapsed recomputes automatically since it calls Date.now()
        // We just need a tick; we'll use a workaround via a dummy state
        this._elapsedTick = (this._elapsedTick ?? 0) + 1;
      }, 1000);

      if (job.type === 'index' && job.params.output) {
        this.recordsTimer = setInterval(() => {
          if (this.activeRpTab === 'records') {
            this.recordsRefreshTick++;
          }
        }, 4000);
      }

      const es = new EventSource(`/jobs/${id}/stream`);
      this.activeStream = es;

      let replayDone = false;
      const replayCount = events.length;
      let seen = 0;

      es.onmessage = (e) => {
        const { type, payload, ts } = JSON.parse(e.data);
        if (!replayDone) {
          seen++;
          if (seen > replayCount) replayDone = true;
          else return;
        }
        if (type === '__done__') {
          es.close();
          this.activeStream = null;
          if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
          if (this.recordsTimer) { clearInterval(this.recordsTimer); this.recordsTimer = null; }
          const finalStatus = (payload as { status: 'done' | 'failed' | 'cancelled' }).status;
          if (this.state.job) {
            this.state.job = { ...this.state.job, status: finalStatus };
          }
          if (!this.currentAction || this.currentAction === 'waiting for your input') {
            this.currentAction = finalStatus === 'done' ? 'job completed' : finalStatus === 'cancelled' ? 'cancelled' : 'job failed';
          }
          jobsStore.refresh();
          if (this.activeRpTab === 'records') {
            this.recordsRefreshTick++;
          }
          return;
        }
        this.processEvent(type, payload as Record<string, unknown>, ts);
      };
      es.onerror = () => es.close();
    }
  }

  processEvent(type: string, payload: Record<string, unknown>, ts?: string) {
    const time = ts ? new Date(ts).toLocaleTimeString() : '';
    const s = this.state;

    switch (type) {
      case 'iter_state':
        s.iteration = payload.iteration as number;
        s.maxIterations = payload.maxIterations as number;
        s.visitedCount = payload.visitedCount as number;
        s.recordCount = payload.recordCount as number;
        this.currentAction = `iteration ${payload.iteration} / ${payload.maxIterations}`;
        break;
      case 'search':
        s.searches = [...s.searches, { query: payload.query as string, count: null, ts: time }];
        this.currentAction = `searching: ${payload.query}`;
        break;
      case 'search_done':
        if (s.searches.length) {
          const last = { ...s.searches[s.searches.length - 1], count: payload.count as number };
          s.searches = [...s.searches.slice(0, -1), last];
        }
        this.currentAction = `search returned ${payload.count} results`;
        break;
      case 'scrape_start': {
        const key = (payload.url ?? payload.provider) as string;
        const newMap = new Map(s.activeScrapes);
        newMap.set(key, { url: key, depth: payload.depth as number | undefined, ts: time });
        s.activeScrapes = newMap;
        const method = payload.method as string | undefined;
        const provider = payload.provider as string | undefined;
        if (method === 'bm25') {
          this.currentAction = `reading ${provider ?? key}\nfiltering for rate data…`;
        } else if (method === 'crawl') {
          this.currentAction = `reading ${provider ?? key}\nfull page crawl — scanning for rates & links…`;
        } else if (method === 'pdf') {
          this.currentAction = `reading ${provider ?? key}\nopening linked document…`;
        } else {
          this.currentAction = `scraping: ${key}`;
        }
        break;
      }
      case 'scrape_done': {
        const key = (payload.url ?? payload.provider) as string;
        const newMap = new Map(s.activeScrapes);
        newMap.delete(key);
        s.activeScrapes = newMap;
        if (!payload.error) {
          s.completedScrapes = [{ ...payload, ts: time } as { url: string; chars?: number; links?: number; ts: string }, ...s.completedScrapes];
          const chars = payload.chars as number ?? 0;
          const method = payload.method as string | undefined;
          const provider = payload.provider as string | undefined;
          if (method === 'bm25') {
            this.currentAction = chars > 200
              ? `read ${provider ?? key}\n${chars} chars of filtered content — extracting…`
              : `read ${provider ?? key}\ntoo little content from BM25 — trying full crawl…`;
          } else if (method === 'crawl') {
            this.currentAction = `read ${provider ?? key}\n${chars} chars — looking for rates in full page…`;
          } else if (method === 'pdf') {
            this.currentAction = `read document for ${provider ?? key}\n${chars} chars — extracting from PDF…`;
          } else {
            this.currentAction = `scraped: ${key} (${chars} chars)`;
          }
        } else {
          this.currentAction = `scrape failed: ${key}`;
        }
        break;
      }
      case 'extract':
        s.extractions = [...s.extractions, {
          url: payload.url as string,
          count: payload.count as number,
          total: payload.total as number,
          ts: time,
        }];
        if ((payload.total as number) > s.recordCount) s.recordCount = payload.total as number;
        this.currentAction = `extracted ${payload.count} records from ${payload.url} (total: ${payload.total})`;
        break;
      case 'agent':
        this.currentAction = payload.message as string;
        break;
      case 'log': {
        const msg = payload.message as string ?? '';
        // translate internal log messages into human-readable ticker text
        if (msg.includes('following promising link')) {
          const link = msg.split('following promising link ')[1] ?? '';
          const isPdf = link.toLowerCase().endsWith('.pdf');
          this.currentAction = isPdf
            ? `found a linked document\ndigging into PDF for rates…\n${link}`
            : `found a promising page link\ndigging deeper…\n${link}`;
        } else if (msg.includes('found no data') && msg.includes('trying full /crawl')) {
          this.currentAction = msg.split(':')[0].trim() + '\nrate not on main page — scanning full content & links…';
        } else if (msg.includes('Searching for official URL')) {
          const provider = msg.replace('Searching for official URL: ', '');
          this.currentAction = `looking up official site\n${provider}`;
        } else if (msg.includes(': found http')) {
          const [prov, url] = msg.split(': found ');
          this.currentAction = `found official site for ${prov}\n${url}`;
        } else if (msg.includes('no official URL found')) {
          this.currentAction = msg;
        } else {
          this.currentAction = msg;
        }
        break;
      }
      case 'error':
        s.errors = [...s.errors, { tool: payload.tool as string | undefined, message: payload.message as string, ts: time }];
        this.currentAction = `error: ${payload.message}`;
        break;
      case 'finish':
        s.recordCount = payload.total as number;
        this.currentAction = `done — ${payload.total} records`;
        break;
      case 'tokens':
        s.totalInputTokens += payload.input as number;
        s.totalOutputTokens += payload.output as number;
        break;
      case 'update_start':
        s.updateTotal = payload.total as number;
        this.currentAction = `starting update — ${payload.total} rows to check`;
        break;
      case 'update_row': {
        const provider = payload.provider as string;
        const changed = payload.changed as boolean;
        const newValue = payload.newValue as string;
        s.updateRows = [{
          provider,
          url: payload.url as string | undefined,
          oldValue: payload.oldValue as string,
          newValue,
          changed,
          ts: time,
          dataset: this.state.job?.params.input as string | undefined,
        }, ...s.updateRows];
        s.updateDone = s.updateDone + 1;
        this.currentAction = changed
          ? `✓ ${provider}\nupdated → ${newValue}`
          : `✓ ${provider}\nno change`;
        break;
      }
    }

    const text = formatEvent(type, payload);
    if (text) {
      s.rawLog = [...s.rawLog, { type, text }];
    }
  }

  reset() {
    if (this.activeStream) { this.activeStream.close(); this.activeStream = null; }
    if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
    if (this.recordsTimer) { clearInterval(this.recordsTimer); this.recordsTimer = null; }
    this.state = defaultState();
    this.jobStartedAt = null;
    this.activeRpTab = 'monitor';
    this.recordsFile = null;
    this.currentAction = 'waiting for your input';
  }

  switchTab(tab: 'monitor' | 'records') {
    this.activeRpTab = tab;
    if (tab === 'records') {
      this.recordsRefreshTick++;
    }
  }

  // internal tick to drive elapsed recomputation
  private _elapsedTick = $state(0);

  getElapsed(): string {
    // access _elapsedTick to create dependency
    void this._elapsedTick;
    if (!this.jobStartedAt) return '--';
    const ms = Math.max(0, Date.now() - this.jobStartedAt.getTime());
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h) return `${h}h ${m % 60}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }
}

export const dashStore = new DashboardStore();
