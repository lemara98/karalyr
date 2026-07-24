# Deploying Karalyr

Target: **karalyr.com on Vercel, with Turso for the database.**

Safe on Vercel as of migration 0008: rate limits and the proof-of-work replay
guard live in the database (`kv_entries`), so every serverless instance shares
them. Before that they were a per-process `Map`, which on serverless meant
limits multiplied by the instance count and a solved PoW nonce could be
replayed against any instance that had not seen it. If you ever revert
`lib/stores/index.ts` to `MemoryStore`, you must run exactly one process.

---

## 1. Database

Create the Turso database, then migrate it **from your machine, pointed at
production**. There is no migration step in the build.

```bash
turso db create karalyr
turso db show karalyr --url          # libsql://…
turso db tokens create karalyr       # the auth token

DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run db:migrate
```

Expect 9 migrations. **Do not run `npm run seed`** — that inserts placeholder
sample tracks meant for local development.

## 2. Secrets

Generate real values; never ship the `change-me` placeholders from
`.env.example`.

```bash
for k in POW_SECRET FINGERPRINT_SALT WORKER_TOKEN KARALYR_INTAKE_SECRET; do
  echo "$k=$(openssl rand -hex 32)"
done
```

## 3. Vercel environment variables

Set these for **Production** (Project → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `libsql://…` from step 1 |
| `DATABASE_AUTH_TOKEN` | token from step 1 |
| `NEXT_PUBLIC_SITE_URL` | `https://karalyr.com` |
| `ADMIN_EMAILS` | your email, comma-separated for more |
| `POW_SECRET` | generated |
| `FINGERPRINT_SALT` | generated |
| `WORKER_TOKEN` | generated |
| `KARALYR_INTAKE_SECRET` | generated |
| `NEXT_PUBLIC_SUPABASE_URL` | same Supabase project as karafilt.com |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public by design |
| `POW_DIFFICULTY` | `19` |

Three that matter more than the rest:

- **`ENABLE_LOCAL_ALIGN` — leave unset.** It exposes the Studio's local
  aligner, which spawns a subprocess on the server. On a public host that is
  remote code execution behind a UI. The capture worker is the hosted-safe
  path and produces the same result.
- **`ADMIN_TOKEN` — leave unset.** `/admin` is gated on a signed-in account
  (`ADMIN_EMAILS`, or `app_admins` in Supabase). The token is a deprecated
  fallback that grants access with no identity attached; it exists only so a
  deploy cannot lock the operator out mid-migration.
- **`FINGERPRINT_SALT`** — changing it later resets every rate limit and
  every per-fingerprint dedupe. Set it once.

## 4. Deploy and attach the domain

Import the GitHub repo in Vercel. The defaults are correct — it is a stock
Next.js app with no Vercel-proprietary APIs. Then add `karalyr.com` under
Project → Domains and point DNS as Vercel instructs.

**Serve the API from your own domain from day one.** Never hand out the
`*.vercel.app` URL: moving off Vercel later is then a DNS change instead of a
breaking change for every client.

## 5. Supabase

Auth is shared with karafilt.com, so the project needs to know about the new
origin. In Supabase → Authentication → URL Configuration, add:

```
https://karalyr.com/**
```

Without it, signing in redirects to localhost and `/admin` is unreachable.

## 6. karafilt.com

Set the **same** `KARALYR_INTAKE_SECRET` on the website, and point its Karalyr
base URL at `https://karalyr.com`. Otherwise extension song submissions are
rejected at `/api/sync-queue/intake` with a 401.

---

## Smoke test

```bash
# public read API — expect 200 and a JSON array
curl -s https://karalyr.com/api/search?q=a | head -c 200

# admin must be closed to anonymous callers — expect 401
curl -s -o /dev/null -w '%{http_code}\n' https://karalyr.com/api/admin/pending

# worker routes must not be reachable cross-origin — expect no CORS allowance
curl -sI -X OPTIONS https://karalyr.com/api/worker/claim | head -1
```

In a browser:

1. `/` renders, search works
2. `/docs` shows `https://karalyr.com` in the curl examples, not localhost
3. `/queue` renders (empty until people request songs)
4. `/admin` redirects to login, and lets you in once signed in as an
   `ADMIN_EMAILS` address
5. Sign in — you should land back on karalyr.com, not localhost

**Confirm the shared store is live**, since this is what makes Vercel safe:

```bash
# 30+ rapid signals from one caller must start returning 429
for i in $(seq 1 35); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://karalyr.com/api/signal \
    -H 'Content-Type: application/json' \
    -d '{"revision_id":1,"type":"explicit_up"}'
done; echo
```

The tail should be `429`s. If it stays `200`/`404` forever, instances are not
sharing state — check `DATABASE_URL` reached the deployment.

## Fulfilling requests in production

Nothing on the server fetches audio. A promoted request is worked from audio
you supply:

- `worker/queue_worker.py --audio <file>` for a song you own
- `capture-extension/` to capture a song from your own playback

Both need `KARALYR_URL=https://karalyr.com` and the production `WORKER_TOKEN`
in `~/.config/karalyr-worker.env`.

## Rollback

Vercel keeps every deployment; promote a previous one from the dashboard.
Migrations are additive and none of them drop data, so a rollback of the app
does not require a database rollback.
