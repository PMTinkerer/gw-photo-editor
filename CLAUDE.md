# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Photo editing tool for Grand Welcome of Southern Coastal Maine. Team members upload winter listing photos, Gemini AI transforms them to summer, employees verify accuracy via a checklist, then download. All usage is logged to a private GitHub repo for prompt optimization.

## Architecture

```
index.html (GitHub Pages)  →  worker/src/index.js (Cloudflare Worker)  →  Gemini API
                                        ↓ async (ctx.waitUntil)
                              PMTinkerer/gw-photo-editor-logs (GitHub Contents API)
```

- **Frontend**: Two standalone HTML files with inline CSS/JS. No build step, no framework, no npm dependencies.
- **Worker**: Stateless proxy (~267 lines). Holds secrets, calls Gemini, logs to GitHub. Zero runtime npm deps.
- **Logs repo**: Private. Append-only JSONL via GitHub Contents API (read-modify-write with SHA optimistic locking).

## Development

```bash
cd worker/
npm ci
cp .dev.vars.example .dev.vars   # fill in GEMINI_API_KEY, GITHUB_TOKEN, ADMIN_PASSWORD
npx wrangler dev                 # local Worker at http://localhost:8787
```

Frontend: open `index.html` directly or serve with any static server. Update `WORKER_URL` to `http://localhost:8787` for local dev.

## Deploy

```bash
cd worker/
npx wrangler deploy              # deploys to https://gw-photo-editor-api.gwphoto.workers.dev
```

Frontend deploys automatically via GitHub Pages on push to `main`.

Secrets are set once via `npx wrangler secret put <NAME>`: `GEMINI_API_KEY`, `GITHUB_TOKEN`, `ADMIN_PASSWORD`.

## Key Design Decisions

- **Single-turn refinement**: `/api/iterate` sends only the current edited image + follow-up text (not conversation history). Multi-turn with thought signatures caused 400 errors from Gemini.
- **Async logging**: `ctx.waitUntil()` ensures logging never blocks user responses. Failures are silently retried (3 attempts with 409 conflict handling) and logged to `console.error`.
- **Checklist gates download**: Employees must complete a 7-item verification checklist in the fullscreen compare modal, then submit a rating, before Download enables. Resets on every new generation.
- **CORS**: Locked to `https://pmtinkerer.github.io`. Dev mode (`ENVIRONMENT=development` env var) adds `http://localhost:8787`.
- **GitHub logging creates files on first write**: `appendToLog` handles 404 (file doesn't exist) by creating it via PUT without SHA.
- **UTF-8 safe base64**: `utf8ToBase64()` wrapper handles emoji and accented characters in property names and feedback text.

## Worker API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/generate` | POST | CORS only | Accept image + prompt, call Gemini, return transformed image |
| `/api/iterate` | POST | CORS only | Accept current image + follow-up text, call Gemini |
| `/api/feedback` | POST | CORS only | Log score, issues, and feedback text |
| `/api/admin/dashboard` | GET | Bearer token | Aggregated stats from both log files |
| `/api/admin/export` | GET | Bearer token | Raw JSONL data for both log files |

## Conventions

- No npm runtime dependencies anywhere. Worker uses only Web APIs (`fetch`, `crypto`, `btoa`/`atob`, `TextEncoder`).
- Frontend state is a single `state` object. No classes, no modules, no imports.
- IDs use `sub_` and `fb_` prefixes with truncated UUIDs.
- Error responses to clients never include upstream error bodies (redacted after the security review). Details go to `console.error` for `wrangler tail`.
- Gemini grounding (Google Search) is enabled only on initial generation, not on refinements.

## Gotchas

- `wrangler` is pinned to exact version `4.80.0` in package.json (supply chain policy).
- The Gemini free tier has **0 images/minute** — billing must be enabled on the Google Cloud project.
- GitHub Contents API has a 1MB file size limit for the read-modify-write pattern. At current volume this is months away from being an issue.
- `index.html` is ~600 lines (over the usual 300-line guideline) because the spec requires a single file with inline CSS/JS. This is an intentional exception.
