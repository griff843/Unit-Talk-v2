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
AUTH_TRUST_HOST=true     # deployment constant, not a secret; see below
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_CAPPER_EMAILS=   # server-authoritative; comma-separated <email>=<canonicalCapperId>
                         # pairs (UTV2-1824). An entry without `=` is dropped, NOT
                         # derived from the local part. Empty admits nobody, and
                         # only emptiness is checked - a malformed value ships green.
UNIT_TALK_API_URL=http://api:4000
NEXT_PUBLIC_API_BASE_URL=
```

### `AUTH_TRUST_HOST`

`apps/smart-form` runs Auth.js v5 (`next-auth@5.0.0-beta`), which refuses any
request whose `Host` it has not been told to trust and answers every
`/api/auth/*` route with `500 UntrustedHost`. `NEXTAUTH_URL` is a v4 name and
does not confer that trust — setting it is not enough, as the first production
deployment demonstrated: the Smart Form served correctly over TLS while sign-in
was impossible.

The value is deliberately **not** a GitHub secret and deliberately **not**
`trustHost: true` in `apps/smart-form/auth.ts`. Trusting a forwarded host is a
statement about a topology, not about the application. Here the deployment
provisions the hostname and puts Caddy in front of it, so the deployment is the
only layer entitled to make that statement; hard-coding it in the app would make
every other runtime — a developer's laptop included — trust whatever `Host` a
caller sends.

It is written to `.env.smart-form` only. The public website performs no
authentication, and `.env.production` must not carry it either.

`NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS` and `SMART_FORM_QA_AUTH_BYPASS` are
deliberately absent. The QA authentication bypass is never enabled in production;
`scripts/ci/nextjs-deploy-wiring.test.ts` asserts that the deploy workflow never
writes either name, and the workflow itself greps the written file and fails the
deploy if one appears.

## The capper signing key is shared, deliberately

`apps/smart-form/auth.ts` signs the capper session bearer with `NEXTAUTH_SECRET`.
`apps/api/src/auth.ts` verifies capper JWTs with `UNIT_TALK_JWT_SECRET`. They must
be the same value or the API rejects every authenticated Smart Form submission
with a 401 while every health check still reports green.

The deploy therefore writes the single configured `NEXTAUTH_SECRET` into two
places: `.env.smart-form` as `NEXTAUTH_SECRET` (the signer) and `.env.production`
as `UNIT_TALK_JWT_SECRET` (the verifier). One owner-supplied secret, two names,
neither exposed to a browser bundle or a build argument. The deploy refuses to
write either file when the value is absent.

## The public API origin is a build input, not a runtime one

`NEXT_PUBLIC_*` values are substituted by `next build`, so writing
`NEXT_PUBLIC_API_BASE_URL` into `.env.smart-form` only affects server-side reads.
The browser bundle takes its origin from the `NEXT_PUBLIC_API_BASE_URL` build
argument, derived from `CADDY_DOMAIN`. Without it the bundle would permanently
carry the `http://127.0.0.1:4000` development fallback from
`apps/smart-form/lib/api-client.ts`. It is a public URL and no secret is ever
passed as a build argument.

## Rolling back one surface

Each Next.js app is its own compose service pinned to its own tagged image, so
one can be replaced without touching the other or the API:

```
UNIT_TALK_IMAGE_TAG=<previous-tag> docker compose up -d --no-deps web
UNIT_TALK_IMAGE_TAG=<previous-tag> docker compose up -d --no-deps smart-form
```
