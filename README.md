# jpl-bus-worker

Cloudflare Worker that turns Pasadena Transit’s GTFS-Realtime feed into clean JSON for **route 53** (Caltech ↔ JPL).

Live example:

```
https://jpl-bus.kanstin.workers.dev/                 HTML stop picker
https://jpl-bus.kanstin.workers.dev/?from=1378&to=2707
```

---

## Why this exists

The agency’s public realtime endpoint is a protobuf trip-update feed. It is sparse (often only the next 1–2 stops per vehicle) and omits `route_id` on many entities. This worker:

- Filters to route 53 only
- Joins against a static schedule snapshot stored in KV
- Estimates missing stop times from scheduled offsets when the realtime feed is incomplete
- Returns a small, CORS-friendly JSON payload suitable for a phone widget or script
- Serves a tiny HTML picker at `/` and `/ui` so you can choose start and destination in a browser

---

## API

All endpoints are `GET`. Stop identifiers accept either the **stop code** printed on the bus stop sign or the internal GTFS `stop_id`.

| Query | Purpose |
|-------|---------|
| `/` or `/ui` | Tiny HTML picker: choose start + destination, list upcoming trips |
| `?stop=2707` | Upcoming arrivals at a single stop |
| `?from=1378&to=2707` | Same-trip predictions: depart `from`, arrive `to` |
| `?stops=1` | Full stop catalog for route 53 (for pickers) |
| `?refresh=1` | Force a pull of the static GTFS zip into KV |

The HTML page calls those same JSON endpoints from the browser. Query-param API responses are unchanged. Bare `/` with no query string is now HTML instead of the old 400 JSON hint.

The picker remembers the last start/destination pair in `localStorage` and refreshes every 20 seconds.

### Example response (`?from=…&to=…`)

```json
{
  "route": "53",
  "feed_version": "20260824",
  "gtfs_last_modified": "2026-08-24T10:25:35.000Z",
  "gtfs_last_modified_epoch": 1787…,
  "updated": "5:17 PM",
  "updated_epoch": 1787…,
  "trips": [
    {
      "route": "53",
      "trip_id": "2451",
      "headsign": "JPL",
      "from": { "id": "727", "code": "1378", "name": "…", "minutes": 12, … },
      "to":   { "id": "462", "code": "2707", "name": "JPL", "minutes": 35, … },
      "estimated": true
    }
  ],
  "from": { … },
  "to":   { … }
}
```

Flags you may see on a trip:

- `estimated` — one or both times were derived from schedule offsets rather than a direct realtime prediction
- `enroute` — the vehicle has already left the `from` stop; the origin minutes are clamped to 0 and the destination prediction is still live (so you can keep watching after boarding)

---

## Key stops

| Code (sign) | Name | Direction |
|-------------|------|-----------|
| 2707 | JPL | both |
| 1378 | Del Mar Blvd & El Molino Ave | to-jpl |
| 1709 | Walnut St & Raymond Ave | to-jpl |
| … | (see `?stops=1`) | |

Opposite curbs have different codes.

---

## How the schedule stays fresh

- **Cron** (Mon–Fri): `12:30` and `22:30` UTC  
  ≈ 5:30 AM / 3:30 PM PDT, or 4:30 AM / 2:30 PM PST  
  (fixed UTC times so you never have to edit the file for DST)
- Manual: `GET /?refresh=1`
- On KV miss the worker falls back to a baked-in snapshot (`FALLBACK` in the source)

The refresh downloads the agency’s static GTFS zip, keeps only route 53, and stores:

- `tripToRoute` / `tripHeadsign`
- ordered stop list (with direction tags)
- per-trip stop times as seconds-past-midnight (used for estimation)

---

## Deploy

### One-time setup

```bash
# Create the KV namespace (once)
npx wrangler kv namespace create JPL_KV

# Paste the returned id into wrangler.toml under [[kv_namespaces]]
```

The KV namespace **id is not a secret** — it is safe (and required) to commit in `wrangler.toml`.

### Local / manual deploy

```bash
npx wrangler deploy
```

### Automatic deploy from GitHub

Cloudflare can watch a GitHub repo and deploy on every push to `main`:

1. Push this project to a GitHub repository.
2. Cloudflare dashboard → **Workers & Pages** → **jpl-bus** → **Settings** → **Builds** → **Connect**.
3. Authorize GitHub, select the repo, set production branch to `main`.

Alternatively use the official [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action) with repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

---

## Project layout

```
├── src/server.js     # HTML picker routing + delegates JSON API to index.js
├── src/index.js      # protobuf decoder, estimation, refresh
├── src/ui.html       # in-page picker (imported as text)
├── wrangler.toml     # name, cron triggers, KV binding, HTML text rule
├── README.md         # this file
└── ARCHITECTURE.md   # deeper explanation of the code
```

---

## Notes

- Route 53 only for now. Glendale Beeline and Foothill Transit do not serve JPL in a useful way for this use-case.
- The agency feed is cached at the edge for ~15 s; responses are cacheable for 20 s.
- CORS is open (`*`) so a static HTML widget or userscript can call it directly.
