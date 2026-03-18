# LLM Providers

Scrappy uses two models per provider: a heavier **agent model** for the index loop (tool-use, reasoning) and a lighter **extract model** for field extraction in update jobs.

## Supported providers

### Anthropic (default)

| Role | Default model |
|---|---|
| Agent | `claude-opus-4-6` |
| Extract | `claude-haiku-4-5-20251001` |

Set `ANTHROPIC_API_KEY` in `.env`.

### OpenAI

| Role | Default model |
|---|---|
| Agent | `gpt-4.1` |
| Extract | `gpt-4.1-mini` |

Set `OPENAI_KEY` in `.env`. You can override the model names in Settings.

### ZordMind (self-hosted)

Single model for both roles. Useful for running fully local.

Set `ZORDMIND_URL` and `ZORDMIND_MODEL` in settings.

## Configuring models

In the web UI: Settings (gear icon) → select provider → set model names.

In `data/settings.json`:

```json
{
  "crawl4aiBase": "http://localhost:11235",
  "llmProvider": "anthropic",
  "anthropicAgentModel": "claude-opus-4-6",
  "anthropicExtractModel": "claude-haiku-4-5-20251001",
  "openaiModel": "gpt-4.1",
  "openaiExtractModel": "gpt-4.1-mini"
}
```

`crawl4aiBase` can also be set here directly or via the `CRAWL4AI_BASE` env var — the UI setting takes precedence.

## Why two models?

The agent loop makes many decisions per run (search queries, which URLs to scrape, which records to extract) and needs strong reasoning. The extract model only needs to read a short filtered page snippet and output a JSON object — a much simpler task where a lightweight model is faster and cheaper.
