# Getting Started

## Requirements

- Node.js 22+
- A running [Crawl4AI](https://crawl4ai.com) instance
- [Anthropic API key](https://console.anthropic.com)
- [SerpAPI key](https://serpapi.com) (for search)

## Install

```bash
git clone <repo>
cd scrappy
npm install
cd ui && npm install && npm run build && cd ..
```

## Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
SERPAPI_KEY=your-serpapi-key
CRAWL4AI_BASE=http://localhost:11235   # sets the default, can be changed in UI
PORT=3000
```

## Start the server

```bash
npm run server
```

Open `http://localhost:3000` in your browser.

## Run your first index job

1. Go to the **Scrape** screen
2. Select or create a schema
3. Enter a research topic (e.g. `Swiss Säule 3a accounts`)
4. Click **Start Index**
5. Switch to **Monitor** to watch the agent work in real time

## CLI alternative

```bash
npm start -- index \
  --topic "Swiss savings accounts" \
  --schema schemas/3a-konto.ts \
  --output my-dataset \
  --max-iterations 40
```
