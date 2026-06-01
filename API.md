# mb-proxy API Reference

Cached proxy for MusicBrainz + Cover Art Archive, deployed as a Cloudflare Worker with KV caching, `musicbrainz-api` client calls, and Durable Object rate limiting.

Forks must define their own `MB_APP_NAME`, `MB_APP_VERSION`, and `MB_APP_CONTACT` before deployment so MusicBrainz receives a deployer-specific User-Agent. This repository intentionally does not ship default values for those fields.

## Base URL

```
https://mb-proxy.your-subdomain.workers.dev
```

## Endpoints

### `GET /`

Health check.

```json
{ "ok": true, "service": "mb-proxy", "version": "0.2.0" }
```

---

### `GET /search?artist=...&album=...&year=...&type=...`

Search for album release groups.

| Param  | Required | Description                          |
|--------|----------|--------------------------------------|
| artist | No*      | Artist name                          |
| album  | No*      | Album title                          |
| year   | No       | Release year (e.g. `1997`)           |
| type   | No       | `album`, `ep`, `single`, `other`     |

\* At least one of `artist` or `album` is required.

**Response:**
```json
[
  {
    "id": "b1392450-e666-3926-a536-22c65f834433",
    "title": "OK Computer",
    "artist": "Radiohead",
    "releaseDate": "1997-05-21",
    "primaryType": "Album"
  }
]
```

**Cache:** 7 days (KV)

**Headers:**
| Header | Value |
|--------|-------|
| `X-Cache` | `HIT` or `MISS` |
| `Cache-Control` | `public, max-age=86400, stale-while-revalidate=604800` |

---

### `GET /release-group/:id/editions`

List editions (releases) belonging to a release group, with format info.

**Response:**
```json
[
  {
    "id": "some-release-uuid",
    "title": "OK Computer",
    "releaseDate": "1997-05-21",
    "country": "GB",
    "formats": ["CD"],
    "trackCount": 12
  }
]
```

**Cache:** 30 days (KV)

---

### `GET /release/:id/tracklist`

Get track titles for a specific release.

**Response:**
```json
[
  "Airbag",
  "Paranoid Android",
  "Subterranean Homesick Alien",
  ...
]
```

**Cache:** 30 days (KV)

---

### `GET /release/:id/cover`

Get cover art URLs for a release.

**Response:**
```json
{
  "artworkUrl": "https://coverartarchive.org/release/.../12345.jpg",
  "thumbnails": {
    "large": "https://coverartarchive.org/release/.../12345-500.jpg",
    "small": "https://coverartarchive.org/release/.../12345-250.jpg"
  }
}
```

Returns `{ "artworkUrl": "", "thumbnails": {} }` if no cover found (HTTP 200, not 404).

**Cache:** 14 days (KV)

---

### `GET /release-group/:id/cover`

Same as above but looks up cover art via the release group MBID.

---

## Error Format

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| 400    | Missing/invalid parameters |
| 502    | Upstream MusicBrainz error |
| 504    | Upstream timeout |

## Upstream Calls and Rate Limiting

MusicBrainz requests use the `musicbrainz-api` package and pass through a single Durable Object, which globally rate-limits misses to **1 request per 1.1 seconds** and deduplicates concurrent identical misses. Cover Art Archive requests use the package's Cover Art Archive client directly and are cached for 14 days.

## TTL Summary

| Data type    | TTL     |
|--------------|---------|
| Search       | 7 days  |
| Release group| 30 days |
| Release info | 30 days |
| Tracklist    | 30 days |
| Cover art    | 14 days |
| Not-found    | 60 days |
