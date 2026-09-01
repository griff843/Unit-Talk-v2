# PROOF: UTV2-1795 — apps/web and apps/smart-form can be deployed, and refuse to run misconfigured

## Merge SHA Binding

MERGE_SHA: 8603aca02d5c2c06ad2507fcb7cae28825262b37
Merge SHA: pending merge
Execution SHA: 8603aca02d5c2c06ad2507fcb7cae28825262b37
PR: https://github.com/griff843/Unit-Talk-v2/pull/1471

`8603aca02d5c2c06ad2507fcb7cae28825262b37` is the last non-proof commit on this
branch. Every receipt below was executed against that exact tree.

---

## Summary

Before this lane, no Next.js application in the repository was deployed anywhere.
Measured on `main` at `4ac025ee`:

- `apps/web` appeared in **no** workflow file.
- `apps/smart-form` appeared only in `qa-fast.yml` and `qa-experience-regression.yml`.
- `deploy/production/docker-compose.yml` defined `api`, `worker`, `ingestor`,
  `discord-bot`, `grading-cron`, `loki`, `grafana`, `caddy` — no Next.js service.
- `deploy/production/Caddyfile` served exactly one site, `{$CADDY_DOMAIN}` → `api:4000`.

This lane adds both applications to the existing Hetzner / Docker / GHCR / Caddy
path: one shared image, two compose services, two Caddy site blocks, one build
job, per-service env files, and a runtime entrypoint that refuses to start on a
configuration that would be silently wrong.

It also **narrows** an existing exposure. Every service with
`env_file: .env.production` — including the public Caddy edge — held the Supabase
service-role key, the Discord bot token and the SGO keys. The compose file's own
comment deferred that as future hardening. Adding Google OAuth credentials to
that file would have widened it further, so the deploy now writes four files and
each container reads only what it needs.

No file under `apps/` is modified. This is not incidental: no lane type admits
both `apps/**` and the deployment paths (`runtime` and `governance` admit the
deploy paths but not `apps/**`; `delivery-ui` admits `apps/**` but neither
`.github/workflows/**` nor `deploy/production/**`). Running `next start` instead
of the standalone server is what removes the need for an `apps/` edit.

---

## Pre-merge

### `pnpm verify`

```text
$ pnpm verify                                        -> exit 0
$ pnpm lint                    (stage of verify)     -> exit 0
$ pnpm type-check              (stage of verify)     -> exit 0
$ pnpm build                   (stage of verify)     -> exit 0
$ pnpm test                    (stage of verify)     -> exit 0
$ r-level-check                (stage of verify)     -> exit 0
```

`scripts/ci/nextjs-deploy-wiring.test.ts` is reachable from required `verify`
through `pnpm test -> pnpm test:ops -> tsx --test`. The executable-wiring gate
confirms it introduced no new unwired test:

```text
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=479 required-reachable=321 optional-reachable=39
                    fixture-helper=0 quarantined=0 unwired=119 (baselined=119 new=0)
```

---

## Runtime Verification

### Both applications build

`pnpm --filter @unit-talk/smart-form... build` **failed** before this lane, and
would have failed in CI: `next build` collects page data for
`/api/auth/[...nextauth]`, and `apps/smart-form/lib/auth-config.ts` throws when
`NODE_ENV=production` and no auth secret is set.

```text
$ pnpm --filter "@unit-talk/web..." build                          -> exit 0
$ pnpm --filter "@unit-talk/smart-form..." build                   -> exit 1
  Error: AUTH_SECRET or NEXTAUTH_SECRET is required in production.
  > Build error occurred
  [Error: Failed to collect page data for /api/auth/[...nextauth]]

$ NEXTAUTH_SECRET=nextauth-build-only-placeholder-not-a-secret \
    pnpm --filter "@unit-talk/smart-form..." build                 -> exit 0
  Route (app)                                Size  First Load JS
  ├ ƒ /api/auth/[...nextauth]                124 B         102 kB
  ├ ○ /login                               2.93 kB         115 kB
  └ ○ /submit                              70.6 kB         189 kB
```

The placeholder is a published constant, not a credential. It exists only in the
discarded builder stage, and the runtime entrypoint refuses to start on it (see
the refusal table below), so it can never become the value that signs a real
session.

### Each health check answers, independently

Both applications were started from their production builds and their exact
compose health-check paths were requested:

```text
$ NODE_ENV=production pnpm exec next start -p 4200   (apps/web)
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4200/          -> 200

$ NODE_ENV=production pnpm exec next start -p 4400   (apps/smart-form)
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4400/login     -> 200
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4400/          -> 307
```

`/` returning 307 is the auth gate redirecting to `/login`. That is why the
Smart Form health check targets `/login` and not `/` — a health check on `/`
would be asserting a redirect, not that the application renders.

### The intake container refuses to start on a configuration that admits nobody

Every refusal below was executed against `deploy/production/nextjs-entrypoint.sh`
under `env -i`, one variable removed at a time:

| Condition | Exit | First line |
| --- | --- | --- |
| no `NEXTAUTH_SECRET` | 1 | `FATAL: NEXTAUTH_SECRET is not set. Refusing to start the intake surface.` |
| `NEXTAUTH_SECRET` is the build placeholder | 1 | `FATAL: NEXTAUTH_SECRET is still the build-time placeholder. Refusing to start.` |
| empty `ALLOWED_CAPPER_EMAILS` | 1 | `FATAL: ALLOWED_CAPPER_EMAILS is empty. No account could sign in; refusing to start.` |
| no `GOOGLE_CLIENT_SECRET` | 1 | `FATAL: Google OAuth credentials are not configured. Refusing to start.` |
| no `NEXTAUTH_URL` | 1 | `FATAL: NEXTAUTH_URL is not set; the Google callback URI would be wrong. Refusing to start.` |
| unset `APP_DIR` | 2 | `APP_DIR: APP_DIR is not set; the image was built without an app` |
| unset `PORT` | 2 | `PORT: PORT is not set; the image was built without a port` |

An empty allow-list is the case worth naming: the application already fails
closed on it, but silently — nobody can sign in while the container reports
healthy. The entrypoint converts that into a visible startup failure.

**Positive controls** (the guards are not blanket refusals):

```text
APP_DIR=deploy PORT=4200                        -> reaches line 43, 0 FATAL lines
APP_DIR=apps/smart-form + full configuration    -> reaches line 43, 0 FATAL lines
```

Line 43 is `exec pnpm exec next start`. Both controls fail only on `pnpm: not
found`, which is an artifact of running under `env -i`, not a refusal.

### Mutation evidence

Each assertion in `scripts/ci/nextjs-deploy-wiring.test.ts` was shown to fail on
the defect it names. Artifact SHA-256 was restored to baseline between every
mutation and re-confirmed at the end.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | drop `ALLOWED_CAPPER_EMAILS` from the secret inventory | `not ok 2` |
| 2 | give the public website `.env.production` | `not ok 4` |
| 3 | hard-code a production hostname in the Caddyfile | `not ok 5` |
| 4 | leak `NEXTAUTH_SECRET` as a build arg | `not ok 4` |
| 5 | publish smart-form on a host port | `not ok 6` |
| 6 | remove `build-nextjs` from canary's `needs` | `not ok 1` |
| 7 | drop the QA-bypass assertion | `not ok 3` |
| 8 | require the standalone server | `not ok 7` |
| 9 | remove the promote health gate | `not ok 6` |
| 10 | bake `NEXTAUTH_SECRET` into the runtime image | `not ok 8` |
| 11 | drop the placeholder rejection from the entrypoint | `not ok 8` |
| 12 | drop the empty-allow-list refusal | `not ok 9` |
| 13 | move a refusal after the server start | `not ok 9` |

```text
=== BASELINE RESTORED
67247ae0da8fae2e840cfb30c06d1368fcfe407c864496e8ccb4926c073ddd9c  .github/workflows/deploy.yml
861f5a617012eb7209f060b96609110d826b5d9e330da2cd97a417530a43d9b7  deploy/production/docker-compose.yml
5d0f83ed531a19a6ab0834c3edc6034e9148b9057cd7c29debf7f5508d333bce  deploy/production/Caddyfile
5abfe34be42b4ec32273e14832a7288200b369b12b0b7f409046e4daf5ac378b  deploy/production/Dockerfile.nextjs
859e305c227845b768b3fb668026de1d222c22cfe2ee1ce0243b0858f5c0be09  deploy/production/nextjs-entrypoint.sh
# pass 9 # fail 0
```

(The Dockerfile hash above is the pre-entrypoint-path-fix baseline used during
mutations 10–13; the committed file additionally takes the entrypoint from the
build context rather than the builder stage, because the builder never copies
`deploy/`.)

---

## Verification

ASSERTIONS:

- [x] `pnpm verify` — exit 0 at `8603aca0`, including `pnpm lint`,
      `pnpm type-check`, `pnpm build`, `pnpm test` and `r-level-check`.
- [x] Both applications build reproducibly; the Smart Form build blocker was
      found by executing it, not by reading it.
- [x] `web` and `smart-form` health-check paths each answer 200, proven
      independently against their production builds.
- [x] Deployment fails closed on absent server-side configuration at three
      points: the `verify` secret inventory, the point of use in `canary` and
      `promote`, and container startup.
- [x] Empty `ALLOWED_CAPPER_EMAILS` refuses to start rather than admitting
      nobody silently.
- [x] `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` and `ALLOWED_CAPPER_EMAILS`
      reach exactly one container, never a build arg, never a browser bundle,
      never `.env.web`, `.env.edge` or `.env.production`.
- [x] The QA authentication bypass cannot reach production: the deploy greps the
      written env file and fails, and `isQaAuthBypassEnabled` returns `false`
      unconditionally when `NODE_ENV=production`.
- [x] No hostname is committed; all three are env vars, exactly as
      `{$CADDY_DOMAIN}` already was. `CADDY_DOMAIN` is passed through unchanged —
      the API keeps the hostname it has.
- [x] Each Next.js surface has its own image tag, health check, memory limit and
      no cross-dependency, so one can be rolled back without the other.
- [x] Neither app publishes a host port; the Caddy edge is the sole ingress.
- [x] All six newly referenced secrets are declared in
      `docs/05_operations/REQUIRED_SECRETS.md`, which `ci-doctor` check `CW6`
      enforces against the workflows.
- [x] Zero files under `apps/` are modified.
- [x] 13 mutations, 13 caught; artifacts byte-identical after each.

EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
ok 1 - both Next.js apps are built and pushed by the deploy workflow
ok 2 - deployment fails closed when required Next.js configuration is absent
ok 3 - the QA authentication bypass never reaches production
ok 4 - server-only credentials reach only the container that needs them
ok 5 - Caddy routes every approved hostname from configuration, not from source
ok 6 - each Next.js surface is independently deployable and rollable
ok 7 - the shared image builds either app without an app-owned config change
ok 8 - the build-time auth placeholder can never become the runtime secret
ok 9 - the intake container refuses to start on a configuration that admits nobody
1..9
# tests 9
# pass 9
# fail 0
```

---

## Residual risks and deferred work

1. **The container images have not been built.** Docker is not installed in this
   WSL distro. What is proven is the substance inside the Dockerfile — both
   `pnpm --filter … build` invocations, executed here — and the workflow wiring
   that invokes them. The image build itself is first exercised by the governed
   `Deploy` dispatch, which cannot run until the owner installs the six secrets;
   the deploy fails closed without them by design.

2. **No production deployment is claimed.** Nothing in this lane deploys
   anything. `Deploy` is `workflow_dispatch`-only and is not triggered here. The
   lane is not "deployed" until a governed dispatch succeeds and both public URLs
   are verified.

3. **Independent rollback is structural, not executed.** Each service is pinned
   to its own image tag with no cross-dependency, and the command is recorded in
   `deploy/production/ENV_FILES.md`. Executing a rollback requires a deployed
   server.

4. **`cc.unittalk.com` is reserved, not served.** Command Center is out of scope;
   no Caddy block claims that hostname, so it remains available.

5. **Production containment is unchanged.** No paid ingestion, no member
   delivery, no system picks; `SYNDICATE_MACHINE_ENABLED` handling is untouched.
