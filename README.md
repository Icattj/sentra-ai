# Sentra AI — OpenAI-compatible MAGI Council API

> Turn MAGI's 12 AI agents into an OpenAI-compatible API. Works with Continue.dev, Cursor, Open WebUI, and any tool that speaks the OpenAI protocol.

## Quick Start

```bash
cd ~/sentra-ai
npm install
pm2 start ecosystem.config.cjs
```

## Endpoints

### `POST /v1/chat/completions`

Standard OpenAI chat completions endpoint with streaming support.

```bash
# Streaming
curl -N http://localhost:3005/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-sentra-magi-2026" \
  -d '{
    "model": "magi-rafael",
    "messages": [{"role": "user", "content": "What should our go-to-market strategy be?"}],
    "stream": true,
    "temperature": 0.7
  }'

# Non-streaming
curl http://localhost:3005/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-sentra-magi-2026" \
  -d '{
    "model": "magi-michael",
    "messages": [{"role": "user", "content": "What are the risks of this approach?"}],
    "stream": false
  }'

# Council Roundtable (all 12 agents weigh in)
curl -N http://localhost:3005/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-sentra-magi-2026" \
  -d '{
    "model": "magi-council",
    "messages": [{"role": "user", "content": "Should we pivot to B2B?"}],
    "stream": true
  }'
```

### `GET /v1/models`

List all available agent-models.

```bash
curl http://localhost:3005/v1/models \
  -H "Authorization: Bearer sk-sentra-magi-2026"
```

### `GET /health`

Health check (no auth required).

```bash
curl http://localhost:3005/health
```

## Available Models

| Model | Agent | Role | Domain |
|-------|-------|------|--------|
| `magi-metis` | Metis | The Librarian | Research & fact-finding |
| `magi-sophia` | Sophia | The Scholar | Academic analysis |
| `magi-rafael` | Rafael | The Architect | Strategy & planning |
| `magi-azrael` | Azrael | The Auditor | Finance & budgets |
| `magi-remiel` | Remiel | The Sentry | Legal & compliance |
| `magi-samael` | Samael | The Prosecutor | Critical thinking |
| `magi-uriel` | Uriel | The Validator | Tech validation |
| `magi-zadkiel` | Zadkiel | The Builder | UI/UX & product |
| `magi-michael` | Michael | Wise Advisor | Risk & advice |
| `magi-gabriel` | Gabriel | The Voice | Marketing & copy |
| `magi-raguel` | Raguel | The Friend | Outreach & community |
| `magi-sarael` | Sarael | The Scribe | Synthesis |
| `magi-auto` | Michael (default) | Auto-routing | General queries |
| `magi-council` | All agents | Roundtable | Multi-perspective |

## Authentication

All requests require `Authorization: Bearer <API_KEY>` header.

Default key: `sk-sentra-magi-2026` (set via `SENTRA_API_KEY` env var)

## Continue.dev Configuration

Add to `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "MAGI Rafael (Strategy)",
      "provider": "openai",
      "model": "magi-rafael",
      "apiBase": "http://localhost:3005/v1",
      "apiKey": "sk-sentra-magi-2026"
    },
    {
      "title": "MAGI Uriel (Tech)",
      "provider": "openai",
      "model": "magi-uriel",
      "apiBase": "http://localhost:3005/v1",
      "apiKey": "sk-sentra-magi-2026"
    },
    {
      "title": "MAGI Council (All Agents)",
      "provider": "openai",
      "model": "magi-council",
      "apiBase": "http://localhost:3005/v1",
      "apiKey": "sk-sentra-magi-2026"
    }
  ]
}
```

## Open WebUI Configuration

1. Go to Settings → Connections → OpenAI API
2. Add:
   - URL: `http://localhost:3005/v1`
   - API Key: `sk-sentra-magi-2026`
3. All 14 models will appear in the model dropdown

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTRA_PORT` | `3005` | Server port |
| `SENTRA_API_KEY` | `sk-sentra-magi-2026` | API authentication key |
| `AWS_REGION` | `us-west-2` | Bedrock region |
| `AWS_ACCESS_KEY_ID` | — | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | — | AWS credentials |
| `BEDROCK_MODEL` | `us.anthropic.claude-sonnet-4-6` | Default Bedrock model |
| `MAX_TOKENS` | `8192` | Max output tokens |
| `LOG_REQUESTS` | `true` | Enable request logging |

## Architecture

```
Client (Continue.dev / Cursor / curl)
  │
  ▼
Sentra AI (Fastify :3005)
  │
  ├── Auth (Bearer token)
  ├── Model → Agent resolution
  ├── Message format conversion (OpenAI → Anthropic)
  │
  ▼
AWS Bedrock (us-west-2)
  └── Claude Sonnet 4.6
```

Direct Bedrock calls — no MAGI v2 proxy. Same credentials, same model.

## PM2 Management

```bash
pm2 start ecosystem.config.cjs   # Start
pm2 restart sentra-ai             # Restart
pm2 logs sentra-ai                # View logs
pm2 stop sentra-ai                # Stop
pm2 delete sentra-ai              # Remove
```
