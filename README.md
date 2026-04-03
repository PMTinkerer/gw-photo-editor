# GW Listing Photo Editor

Transform winter vacation rental listing photos into summer versions using AI. Built for Grand Welcome of Southern Coastal Maine.

## Architecture

```
GitHub Pages (index.html) → Cloudflare Worker → Gemini API
                                    ↓
                          GitHub Logs Repo (private)
```

- **Frontend**: Single HTML file, vanilla JS, no build step
- **Backend**: Cloudflare Worker proxy (keeps API keys server-side)
- **Image API**: Google Gemini `gemini-3-pro-image-preview`
- **Logging**: Private GitHub repo via Contents API

## Setup

### 1. Get API Keys

- **Gemini API key**: [aistudio.google.com](https://aistudio.google.com) → Create API Key. Billing must be enabled (free tier has 0 images/minute).
- **GitHub PAT**: Settings → Developer Settings → Fine-grained tokens. Scope to `gw-photo-editor-logs` repo only, Contents read/write.
- **Admin password**: Any strong random string (`openssl rand -base64 32`).

### 2. Deploy Worker

```bash
cd worker/
npm ci
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npx wrangler deploy
```

Note the deployed URL (e.g., `https://gw-photo-editor-api.youraccount.workers.dev`).

### 3. Configure

- Update `WORKER_URL` in `index.html` with your Worker URL
- Update the CORS `ALLOWED_ORIGIN` in `worker/src/index.js` with your GitHub Pages URL

### 4. Enable GitHub Pages

Repo Settings → Pages → Source: Deploy from branch → main → / (root)

### 5. Initialize Logs Repo

The `gw-photo-editor-logs` repo should contain:
- `submissions.jsonl` (empty)
- `feedback.jsonl` (empty)
- `prompt_versions.json` (seeded with v1 prompt)

## Usage

1. Open the GitHub Pages URL
2. Enter property name
3. Upload a winter listing photo
4. Click Generate
5. Review result, provide feedback
6. Download when satisfied

## Admin

Visit `/admin/` and enter the admin password to view usage stats, score distribution, and export data.

## Updating the Prompt

1. Edit `prompt_versions.json` in the logs repo (add new version, set `is_active: true`)
2. Update the default prompt in `index.html`
