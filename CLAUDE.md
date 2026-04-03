# GW Listing Photo Editor

## Project Overview

Web tool for transforming winter vacation rental listing photos to summer using Gemini image generation. Static frontend on GitHub Pages, Cloudflare Worker proxy, logging to private GitHub repo.

## Architecture

- `index.html` — Main app (vanilla HTML/CSS/JS, no build step)
- `admin/index.html` — Admin dashboard
- `worker/src/index.js` — Cloudflare Worker (~200 lines)
- Logs stored in `PMTinkerer/gw-photo-editor-logs` (private repo)

## Worker URL

Update this after first deploy:
```
WORKER_URL = "https://gw-photo-editor-api.PMTinkerer.workers.dev"
```

## Development

```bash
cd worker/
npm ci
cp .dev.vars.example .dev.vars  # Fill in real values
npx wrangler dev                # Local Worker dev server
```

## Secrets (set via wrangler secret put)

- `GEMINI_API_KEY` — Google Gemini API key (billing must be enabled)
- `GITHUB_TOKEN` — Fine-grained PAT scoped to gw-photo-editor-logs with Contents read/write
- `ADMIN_PASSWORD` — Bearer token for admin endpoints

## Conventions

- No npm dependencies in frontend — vanilla JS only
- Worker uses only Web APIs — no npm runtime dependencies
- All state lives in the browser; Worker is stateless
- Logging is async via `ctx.waitUntil()` — never blocks user responses
- CORS locked to GitHub Pages origin only
