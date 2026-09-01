# Production env files

`.github/workflows/deploy.yml` writes four env files to the deploy host. This
document records their SHAPE only — it is checked into the repository, so it
must never contain a real value.

`deploy/production/.env.production.example` would have been the conventional
name, but `.gitignore` line 7 excludes `.env.*`, so the shapes live here instead.

| File | Read by | Holds |
| --- | --- | --- |
| `.env.production` | `api`, `worker`, `ingestor`, `discord-bot`, `grading-cron` | Supabase, Discord, SGO, runtime mode |
| `.env.web` | `web` | public URLs only — no secret |
| `.env.smart-form` | `smart-form` | Auth.js/Google credentials, capper allow-list |
| `.env.edge` | `caddy` | hostnames only |

Splitting them is deliberate. The public website and the public TLS edge have no
reason to hold the Supabase service-role key, the Discord bot token or the SGO
keys, and the capper intake surface has no reason to hold them either. Before
UTV2-1795 every service with `env_file: .env.production` — the public edge
included — held all of them.

## `.env.edge`

Site addresses for the Caddy edge, sourced from repository secrets. Caddy refuses
to start on an empty site address, so a missing hostname fails closed rather than
serving an application on the wrong name.

```
CADDY_DOMAIN=
UNIT_TALK_WEB_DOMAIN=
UNIT_TALK_SMART_FORM_DOMAIN=
```

## `.env.web`

`NEXT_PUBLIC_*` values are inlined into the client bundle by Next.js and are
therefore never secret.

```
NODE_ENV=production
PORT=4200
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SITE_URL=
```

## `.env.smart-form`

Server-only. None of `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` or
`ALLOWED_CAPPER_EMAILS` may ever appear in a browser bundle, an image layer, a
repository file or a log line.

```
NODE_ENV=production
PORT=4400
NEXTAUTH_URL=            # exact public https:// origin; Auth.js derives the Google callback URI from it
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_CAPPER_EMAILS=   # server-authoritative, comma-separated; empty admits nobody
UNIT_TALK_API_URL=http://api:4000
NEXT_PUBLIC_API_BASE_URL=
```

`NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS` and `SMART_FORM_QA_AUTH_BYPASS` are
deliberately absent. The QA authentication bypass is never enabled in production;
`scripts/ci/nextjs-deploy-wiring.test.ts` asserts that the deploy workflow never
writes either name, and the workflow itself greps the written file and fails the
deploy if one appears.

## Rolling back one surface

Each Next.js app is its own compose service pinned to its own tagged image, so
one can be replaced without touching the other or the API:

```
UNIT_TALK_IMAGE_TAG=<previous-tag> docker compose up -d --no-deps web
UNIT_TALK_IMAGE_TAG=<previous-tag> docker compose up -d --no-deps smart-form
```
