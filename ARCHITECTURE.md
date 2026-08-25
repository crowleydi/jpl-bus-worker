# Architecture & code walk-through

This document explains how `jpl-bus-worker` works in more detail than the inline comments. It is intended for someone who wants to modify the estimation logic, the protobuf decoder, or the static-schedule refresh.

---

## High-level flow

```
Client request
    │
    ▼
fetch handler
    ├── ?refresh=1  →  download gtfs.zip → parse → write KV → return summary
    ├── ?stops=1    →  return stop catalog from schedule
    └── ?stop= / ?from=&to=
            │
            ▼
        loadSchedule()          # KV first, else FALLBACK
            │
            ▼
        fetch GTFS-RT protobuf  # edge-cached ~15 s
            │
            ▼
        decodeFeedMessage()     # hand-rolled protobuf reader
            │
            ▼
        for each entity:
            keep only route 53 trips
            build Map<stopId, predictedEpoch>
            estimatePair() or estimateStop()
            collect trips
            │
            ▼
        sort + JSON response (CORS, short cache)
```

Cron triggers call the same `refreshGtfs()` path that `?refresh=1` uses.

---

## Data sources

| Source | URL / location | Role |
|--------|----------------|------|
| GTFS-Realtime trip updates | `https://rt.pasadenatransit.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate` | Live vehicle predictions (protobuf) |
| Static GTFS zip | `https://rt.pasadenatransit.net/rtt/public/resource/gtfs.zip` | Trip ↔ route, headsigns, stop sequences, scheduled times |
| Cloudflare KV (`JPL_KV`) | key `gtfs53` | Cached, trimmed schedule derived from the zip |
| `FALLBACK` constant | compiled into the worker | Last-resort snapshot when KV is empty or unbound |

The realtime feed frequently **omits `route_id`**. That is why the static `tripToRoute` map is required — without it almost every entity would be dropped.

The same feed is also **sparse**: many trip updates contain only one or two `stop_time_update` entries (the imminent stops). Intermediate and far-downstream stops are often missing. The estimation layer exists to fill those gaps.

---

## Schedule object shape

Both KV and `FALLBACK` store the same logical structure:

```js
{
  feed_version: "20260824",
  gtfs_last_modified: "2026-08-24T10:25:35.000Z",  // HTTP Last-Modified of the zip
  gtfs_last_modified_epoch: 1787…,
  refreshed_epoch: 1787…,          // when we last pulled the zip into KV
  tripToRoute:  { "2451": "53", … },
  tripHeadsign: { "2451": "JPL", … },
  tripStopTimes: {
    "2451": [
      { id: "728", sec: 24660 },   // seconds past midnight
      { id: "116", sec: 24714 },
      …
      { id: "462", sec: 26220 }
    ],
    …
  },
  stops: [
    { id, code, name, dir: "to-jpl" | "from-jpl" | "both" },
    …
  ]
}
```

`tripStopTimes` is the key enabler for estimation. Each array is ordered by GTFS `stop_sequence`. `sec` is the scheduled arrival/departure expressed as seconds past midnight (GTFS allows values ≥ 24:00 for trips that cross midnight; the arithmetic still works).

---

## Estimation logic

### Why it is needed

A typical realtime update for a to-JPL trip might contain only:

```
stop 728 (Wilson & Del Mar)  →  predicted epoch
```

The caller asked for Del Mar & El Molino (`727`) → JPL (`462`). Neither appears in the protobuf. Without help the trip would be discarded.

### How `estimatePair` works

1. Look up the ordered `tripStopTimes[tripId]` array.
2. Find the indices of the requested `from` and `to` stops. Reject the trip if either is missing or if `to` is not after `from`.
3. Among the stops that *do* have a realtime prediction, pick the one whose sequence index is closest to the board stop. Record that prediction epoch and its scheduled `sec`.
4. Apply a pure relative offset:

   ```
   estimated_depart = pred + (sched_from_sec - sched_ref_sec)
   estimated_arrive = pred + (sched_to_sec   - sched_ref_sec)
   ```

5. Drop the trip only if the **destination** is already more than ~60 s in the past. Origin may be past (the bus has left the board stop); in that case the response includes `"enroute": true` and origin minutes are clamped to 0.

The same relative-offset idea is used by `estimateStop` for single-stop queries. If an exact realtime time exists it is preferred; otherwise the closest predicted stop on the trip is used as the reference.

### Properties of the approach

- No absolute “midnight” conversion is required — everything is relative, so day boundaries and DST are irrelevant to the arithmetic.
- Once the vehicle is past the origin, later realtime predictions still produce a consistent delay that can be applied to the destination.
- When both stops happen to be present in the protobuf, `estimated` stays `false` and the raw times are used unchanged.

---

## Protobuf decoder

The worker ships a minimal, dependency-free decoder that understands only the fields we actually read:

```
FeedMessage
  entity[]                  (field 2)
    trip_update             (field 3)
      trip                  (field 1)
        trip_id             (field 1, string)
        route_id            (field 5, string)   // often empty
      stop_time_update[]    (field 2)
        arrival             (field 2)
          time              (field 2, varint)   // POSIX seconds
        departure           (field 3)
          time              (field 2, varint)
        stop_id             (field 4, string)
```

Wire types handled: varint (0), 64-bit (1), length-delimited (2), 32-bit (5). Everything else is skipped. The `Reader` class is a simple cursor over a `Uint8Array`.

This keeps the worker small and avoids pulling in a full protobuf runtime.

---

## Static GTFS refresh

`refreshGtfs(env)`:

1. Downloads the agency zip and records the HTTP `Last-Modified` header (`gtfs_last_modified` / `_epoch`).
2. Uses a tiny zip walker (`unzipNamed`) that locates the central directory, finds the named members, and inflates them with the platform `DecompressionStream` (`deflate-raw`).
3. Parses only `trips.txt`, `stops.txt`, `stop_times.txt`, and `feed_info.txt` via a minimal CSV splitter that understands quoted fields.
4. Builds the schedule object described above (route 53 only), including `feed_version` from `feed_info.txt`.
5. Writes it to KV under the key `gtfs53`.

Representative stop order for the public catalog is taken from the longest trip in each direction (`to-jpl` / `from-jpl`). Direction is inferred from `trip_headsign` (contains “JPL” or “Caltech”) with a fallback to GTFS `direction_id`.

The whole path is also exposed as `GET /?refresh=1` so you can force an update without waiting for cron.

---

## Request handling details

- **CORS** — `Access-Control-Allow-Origin: *` on every response so browser widgets work without a proxy.
- **Caching** — the upstream GTFS-RT fetch is edge-cached for 15 s (`cf.cacheTtl`). Successful JSON responses are marked `Cache-Control: public, max-age=20`.
- **Stop resolution** — `resolveStop` accepts either `stop_code` (the number on the sign) or internal `stop_id`. Opposite curbs are distinct codes.
- **Sorting** — from-to results are ordered by destination time; single-stop results by the stop time. This keeps an en-route vehicle near the top of a from-to list instead of disappearing or sorting oddly.

---

## Cron

Defined in `wrangler.toml`:

```toml
crons = ["30 12 * * 1-5", "30 22 * * 1-5"]
```

Cloudflare Workers cron is always UTC. The chosen times produce approximately:

| | PDT (UTC−7) | PST (UTC−8) |
|---|-------------|-------------|
| Morning | 5:30 AM | 4:30 AM |
| Afternoon | 3:30 PM | 2:30 PM |

Because the expressions are pure UTC they never need editing when the clocks change. The one-hour local shift is accepted as the trade-off.

---

## Fallback behaviour

If the `JPL_KV` binding is missing or the key is empty, `loadSchedule` returns a deep copy of the compile-time `FALLBACK` object (currently built from feed version `20260819`). The worker continues to serve predictions, just with potentially stale trip/stop metadata until a successful refresh occurs.

After any code change that adds fields to the schedule object (for example `tripStopTimes`), run `?refresh=1` once so KV is rewritten with the new shape. Older KV entries without the new fields still work — estimation simply falls back to the stricter “both stops must appear in the protobuf” path.

---

## Extension points

- **Additional routes** — generalise `ROUTE`, the filter inside `refreshGtfs`, and the FALLBACK construction. The estimation and decoder are already route-agnostic.
- **Trip follow mode** — a `?trip=2451` endpoint that returns every remaining stop for one vehicle would be a natural next step for “I boarded this bus, keep updating all downstream ETAs.”
- **Shape / vehicle position** — the agency also publishes a vehicle-position feed; it is not consumed today.
- **Multiple agencies** — the original design deferred Glendale Beeline; Foothill Transit does not usefully serve JPL for this commute.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/index.js` | Everything: HTTP handler, cron entrypoint, schedule load/refresh, estimation, protobuf + zip + CSV helpers, FALLBACK snapshot |
| `wrangler.toml` | Worker name, compatibility date, cron triggers, KV binding |
| `README.md` | User-facing overview and deploy instructions |
| `ARCHITECTURE.md` | This document |
