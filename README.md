# Karalyr

An open-source, LRCLIB-style lyrics database purpose-built for **karaoke**:
word-level timed lyrics, community corrections, and an open JSON API. Karalyr
is the data backbone for [Karafilt](https://karafilt.com) (real-time
vocal removal + synced lyrics in the browser). Non-commercial, MIT-licensed.

Why not just LRCLIB? LRCLIB is line-level and has no correction loop. Karaoke
needs word-level highlighting, duet parts, and a way for singers to fix
timing — without accounts. Karalyr adds all of that while staying
API-compatible: an LRCLIB client works by swapping the base URL.

## Quick start

```bash
npm install
npm run db:migrate   # creates data/karalyr.db and applies migrations
npm run seed         # 7 sample tracks (original placeholder lyrics)
npm run dev          # http://localhost:3000
```

Or with Docker: `docker compose up` (same steps inside a node:24 container).

Run the tests with `npm test` (format converters, ranking, promotion rules).

## API summary

Base URL: `http://localhost:3000`. Full docs with curl examples at `/docs`.

| Endpoint | Description |
| --- | --- |
| `GET /api/get?artist_name=&track_name=&album_name=&duration=` | Best lyrics for an exact match (±2s duration). 404 triggers a lazy LRCLIB import — retry shortly after. |
| `GET /api/get/:track_id` | Same, by internal id |
| `GET /api/search?q=` | Full-text search (FTS5) over artist/title/album |
| `POST /api/request-challenge` | Proof-of-work challenge for publishing |
| `POST /api/publish` | Submit lyrics (structured payload, or raw LRC / Enhanced LRC / UltraStar) |
| `POST /api/signal` | 👍 / 👎 / clean playthrough / timing offset report |
| `GET /api/track/:id/revisions` | Public revision history |

Responses are LRCLIB-shaped (`plainLyrics`, `syncedLyrics`) plus a `karalyr`
object: `{ payload, tier, source, revision_id, has_word_timing }`. `payload`
is the native format — lines with `start_ms`/`end_ms`/`singer` and optional
per-word timing.

## Architecture notes

### Revisions, not edits

Lyrics are **immutable revisions**. Every submission — import, user upload,
correction — is a new row; nothing is overwritten and history is public.
Each revision has:

- a **source**: `lrclib_import`, `auto_aligned`, `user_submission`,
  `ultrastar_import`, `correction`
- a **tier**: `imported < auto_aligned < community < verified`
- a **status**: `active`, `pending_review`, `rejected`, `reverted`

The API serves the *best* active revision per track: highest tier first, then
most net-positive signals (deduped per fingerprint), then newest. The winner
is materialized in `tracks.best_revision_id` and recomputed on every write
that could change it (new revision, new signal, moderation) — reads stay a
simple indexed lookup, which matters because `/api/get` is the hot path.

### Signals and promotion

Anonymous feedback (`signals`) drives quality:

- **≥3 positive signals** (👍 or clean playthrough) from distinct
  fingerprints since the last promotion, with no 👎 in the past 7 days →
  the revision is **promoted one tier** (capped at `verified`).
- **≥3 timing-offset reports** from distinct fingerprints agreeing within
  ±150 ms → a new `correction` revision is auto-created with the **median
  offset** applied to every timestamp.
- Edits targeting a track whose best revision is `verified` enter
  `pending_review` and only go live via the moderation queue at `/admin`
  (gated by a signed-in admin account — `ADMIN_EMAILS` or `app_admins`).

### Abuse control without accounts

- Publishing requires an LRCLIB-style **proof-of-work**: solve
  `sha256(prefix + nonce) <= target` in the browser (~1–2 s, difficulty via
  `POW_DIFFICULTY`). Challenges are HMAC-signed (stateless), expire in 10
  minutes, and are single-use.
- Per-fingerprint **rate limits** on publish/signal. A fingerprint is
  `sha256(ip | user-agent | salt)` — raw IPs are never stored.
- In dev only, the `X-Karalyr-Debug-Fp` header overrides the fingerprint so
  you can exercise the promotion rules from one machine.

### Seams for growth

Two pieces are deliberately behind interfaces with in-process
implementations, so they can be upgraded without touching route handlers:

- `lib/stores/kv.ts` — rate-limit counters + PoW replay guard (swap the
  in-memory store for Redis/Turso when running multiple instances)
- `lib/lazy-import/queue.ts` — background jobs (swap fire-and-forget for a
  real queue). The lazy importer fetches misses from LRCLIB with a polite
  User-Agent and stores them as `lrclib_import` revisions.

### Lyrics payload

```json
{
  "format_version": 1,
  "lines": [
    {
      "start_ms": 12040, "end_ms": 15200, "singer": null,
      "text": "Hello world",
      "words": [
        { "text": "Hello", "start_ms": 12040, "end_ms": 12550 },
        { "text": "world", "start_ms": 12600, "end_ms": 13100 }
      ]
    }
  ],
  "meta": { "language": "en", "has_word_timing": true, "countdown_lines": [] }
}
```

`words` is optional (line-level imports set `has_word_timing: false`);
`singer` is `"P1" | "P2" | "BOTH" | null` for duets. Converters in
`lib/formats/` import plain LRC, Enhanced LRC (`<mm:ss.xx>` word tags), and
UltraStar `.txt` (beat timing mapped via `ms = GAP + beat * 15000 / BPM`),
and export plain/Enhanced LRC. All converters are pure functions with
round-trip tests.

## Deployment

The app is a single standard Next.js project with zero Vercel-proprietary
APIs — route handlers, libSQL, and nothing else.

Full walkthrough in [DEPLOY.md](DEPLOY.md).

- **Now (Vercel + Turso):** create a Turso database, run the migrations
  against it, set `DATABASE_URL` (libsql://…) + `DATABASE_AUTH_TOKEN` +
  the secrets from `.env.example`, deploy. Safe on multiple instances since
  migration 0008 — rate limits and the PoW replay guard share state through
  `kv_entries` rather than process memory.
- **Later (VPS):** `npm run build && npm start` behind any reverse proxy;
  `DATABASE_URL` can stay Turso or go back to a local file.
- **Important:** serve the API from a **custom domain you own** (e.g.
  `api.karalyr.com`) from day one — never hand out the `*.vercel.app` URL.
  Moving off Vercel is then only a DNS change and no client ever breaks.

## License

MIT — see [LICENSE](LICENSE). Seed data contains only original placeholder
verses; real lyrics arrive via user contributions and LRCLIB imports.
