# Deploying mb-proxy

## Prerequisites

- Cloudflare account
- `wrangler` CLI (globally installed via pnpm)
- GitHub repo: https://github.com/ybaspinar/mb-proxy

## First-time setup

### 1. Create KV namespace

```bash
wrangler kv namespace create MB_CACHE
```

This returns a namespace ID. Put it in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "MB_CACHE",
    "id": "<paste-namespace-id-here>"
  }
]
```

### 2. Deploy

```bash
pnpm run deploy
```

This outputs your Worker URL, e.g. `https://mb-proxy.<your-subdomain>.workers.dev`.

### 3. Point the frontend at it

In `album-poster-generator/.env`:

```
VITE_MB_PROXY_URL=https://mb-proxy.<your-subdomain>.workers.dev
```

## Updating the frontend

The frontend needs a service layer that calls the Worker instead of MusicBrainz directly.

Routes:
- `GET /search?q=<query>&offset=0&limit=25` — search release groups
- `GET /release/<mbid>` — full release with recordings + media
- `GET /tracklist/<mbid>` — tracks for a release (lightweight)
- `GET /cover/<release-mbid>` — cover art from Cover Art Archive
- `GET /cover-group/<rg-mbid>` — cover art by release group ID
