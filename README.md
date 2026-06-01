# mb-proxy

Cloudflare Worker proxy for MusicBrainz + Cover Art Archive with KV caching and Durable Object rate limiting.

## Fork and deploy

```txt
pnpm install
pnpm exec wrangler login
pnpm exec wrangler kv namespace create MB_CACHE
```

Wrangler can deploy with the KV binding name only, but if your account requires an explicit namespace ID, copy the created namespace ID into `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "MB_CACHE",
    "id": "<your-kv-namespace-id>"
  }
]
```

Then define your own MusicBrainz app identity before deploying. This repository intentionally does not ship defaults because MusicBrainz expects a meaningful deployer-specific User-Agent.

For local development, create `.dev.vars`:

```txt
MB_APP_NAME=your-app-name
MB_APP_VERSION=0.1.0
MB_APP_CONTACT=https://github.com/your-user/your-repo
ALLOWED_ORIGINS=https://ybaspinar.dev
```

For deployment, either add your own `vars` block to `wrangler.jsonc` in your fork:

```jsonc
"vars": {
  "MB_APP_NAME": "your-app-name",
  "MB_APP_VERSION": "0.1.0",
  "MB_APP_CONTACT": "https://github.com/your-user/your-repo",
  "ALLOWED_ORIGINS": "https://ybaspinar.dev"
}
```

or set equivalent Worker variables in the Cloudflare dashboard. `pnpm run deploy` uses `wrangler deploy --keep-vars` so dashboard-managed variables are preserved. Do not use someone else's contact URL for a public fork.

`ALLOWED_ORIGINS` is a comma-separated exact Origin allowlist. If unset, the Worker defaults to `https://ybaspinar.dev`.

```txt
pnpm run cf-typegen
pnpm test
pnpm exec tsc --noEmit --noUnusedLocals
pnpm exec wrangler deploy --dry-run
pnpm run deploy
```

## Local development

```txt
pnpm run dev
```

## API

See [`API.md`](./API.md).
