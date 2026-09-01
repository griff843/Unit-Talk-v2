# UTV2-1795 — Diff Summary

**Issue:** UTV2-1795 — Shared Next.js production deployment
**Branch:** `claude/utv2-1795-shared-nextjs-deployment`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1471
**Tier:** T1
**Lane type:** runtime
**Implementation SHA:** `dc311970c5b50486ef4636a53ed58245dee09518`
MERGE_SHA: dc311970c5b50486ef4636a53ed58245dee09518

**Merge SHA:** pending merge (anchor `dc311970c5b50486ef4636a53ed58245dee09518`)

## Files Changed

| File | Change |
| --- | --- |
| `deploy/production/Dockerfile.nextjs` | **new** — one multi-stage image for both Next.js apps, selected by `APP_DIR` / `APP_PACKAGE` / `APP_PORT` build args. Runs `next start`, so neither app's own config needs `output: 'standalone'`. Builder stage supplies a published non-secret auth placeholder because `next build` evaluates the Auth.js route. |
| `deploy/production/nextjs-entrypoint.sh` | **new** — runtime entrypoint. Refuses to start the intake surface without a real `NEXTAUTH_SECRET`, without Google credentials, without `NEXTAUTH_URL`, or with an empty `ALLOWED_CAPPER_EMAILS`; rejects the build placeholder outright. |
| `deploy/production/docker-compose.yml` | adds `web` (4200) and `smart-form` (4400): own image tag, health check, memory limit, network-only. Narrows `caddy` from `.env.production` to `.env.edge` — the public edge no longer holds the Supabase service-role key, the Discord bot token or the SGO keys. |
| `deploy/production/Caddyfile` | adds site blocks for `{$UNIT_TALK_WEB_DOMAIN}` → `web:4200` and `{$UNIT_TALK_SMART_FORM_DOMAIN}` → `smart-form:4400`; factors shared security headers and JSON logging into snippets; `no-store` + `same-origin` on the intake surface. `{$CADDY_DOMAIN}` → `api:4000` is unchanged. |
| `deploy/production/ENV_FILES.md` | **new** — shape of the four env files and the per-service rollback command. Named `.md` rather than `.env.production.example` because `.gitignore` line 7 excludes `.env.*`. |
| `.github/workflows/deploy.yml` | adds the `build-nextjs` matrix job; extends the secret inventory with seven fail-closed checks; adds `Write Next.js service env files to server` to both `canary` and `promote`; extends the registry preflight from 4 to 6 images; adds `Verify Next.js surfaces are healthy` to `promote`. |
| `scripts/ci/nextjs-deploy-wiring.test.ts` | **new** — 9 assertions over the real deployment artifacts. Every one shown to fail on the defect it names. |
| `docs/05_operations/REQUIRED_SECRETS.md` | declares the six new secrets. Required, not optional: `ci-doctor` check `CW6` fails when a workflow references a secret this file does not list. |
| `package.json` | adds the wiring test to `test:ops`, so it runs inside required `verify`. |
| `docs/06_status/lanes/UTV2-1795.json` | lane manifest. |

## Manifest Files Changed

- `docs/06_status/lanes/UTV2-1795.json`
- `.ops/sync/UTV2-1795.yml`

## Not Changed

- **Nothing under `apps/`.** No lane type admits both `apps/**` and the deploy paths; running `next start` rather than the standalone server is what removes the need for an `apps/` edit.
- `deploy/rollback.sh`, the root `Dockerfile`, and every existing compose service other than `caddy`'s env file.
- `CADDY_DOMAIN` — the API keeps the hostname it already has.

## Verification

`pnpm verify` exit 0 at the pre-correction tree; `pnpm lint`, `pnpm type-check` and the wiring suite re-executed at `dc311970`, with full `pnpm verify` produced by required CI at this head. Both application builds executed. Both health-check paths executed. Seven startup refusals and two positive controls executed. The production browser bundle was built twice to prove the localhost fallback is present without the build argument and absent with it. A Smart Form-signed capper token was validated through the API's own verifier and refused under a different key. 17 mutations, 17 caught. Full receipts in `verification.md`.
