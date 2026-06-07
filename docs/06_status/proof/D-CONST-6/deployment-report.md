# D-CONST-6 Deployment Report

**Date:** 2026-06-07 | **Lane:** UTV2-1227 | **Executor:** Claude/Ops

## Secret handling

| Check | Result |
|---|---|
| SGO_API_KEY present in local.env | PRESENT (non-empty) |
| SGO_API_KEY present in .env | PRESENT (non-empty) |
| SGO_API_KEY set in GitHub Actions secrets | YES — updated 2026-06-07T13:32:55Z |
| Secret value printed or logged | NO |
| Secret committed to any file | NO |
| UNIT_TALK_INGESTOR_API_KEY in GitHub secrets | YES (pre-existing, 2026-05-17) |

Canonical variable name: `SGO_API_KEY` (confirmed from deploy.yml and env.ts).

## Deployment drift (pre-restore state)

| Item | Value |
|---|---|
| Previous production SHA | `63b7814c6ad95862fc7a56b8a0fe1e2ba566501b` |
| Previous deploy date | 2026-05-21T04:37:02Z |
| UTV2-1014 (env delivery fix) in previous deploy | YES |
| UTV2-1011 (freshness query fix) in previous deploy | NO — merged after deploy |
| Wave-5 scoring code in previous deploy | NO |
| SGO_API_KEY in GitHub secrets at previous deploy | NO — key not set; `.env.production` written with empty key |

**Root cause:** SGO_API_KEY was not in GitHub secrets when the 2026-05-21 deploy ran. The `deploy.yml` wrote `.env.production` to Hetzner with `SGO_API_KEY=` (empty). Hetzner ingestor daemon has been running with `options.apiKey = undefined`, silently skipping all SGO ingest cycles. This is consistent with ~17-day offer staleness.

## Workflow fixes applied

| Commit | Fix |
|---|---|
| `e00dd43f` | Add `UNIT_TALK_INGESTOR_RUNTIME_MODE=fail_closed` to `ingestor-scheduled-run.yml` — production config guard requires this |
| `b4188980` | Add `UNIT_TALK_INGESTOR_API_KEY` (from secrets) and `UNIT_TALK_API_URL=http://localhost:4000` to `ingestor-scheduled-run.yml` |

## Diagnostic run results

| Run | ID | Result |
|---|---|---|
| Run 1 (fail: runtime mode) | 27094066271 | `RUNTIME_MODE_MUST_FAIL_CLOSED` — missing env var |
| Run 2 (fail: missing keys) | 27094103549 | `RUNTIME_REQUIRED_ENV_MISSING` — UNIT_TALK_API_URL, UNIT_TALK_INGESTOR_API_KEY |
| Run 3 (partial success) | 27094141988 | **Offer ingest phase SUCCESS** — 1,523 SGO/NBA offers written to `provider_offer_current` at 13:38:28Z; results/repoll phase failed (transient Supabase 521 — non-fatal for ingestion proof) |

**SGO key validity confirmed:** the key authenticated successfully and returned live event data.

## Freshness proof

| Metric | Value |
|---|---|
| `provider_offer_current` latest | 2026-06-07T13:38:28Z |
| `provider_offer_current` total rows | 257,880 |
| Age at freshness check | ~4 minutes |
| `stage:freshness` Offers verdict | **FRESH** |
| `stage:freshness` overall verdict | DEGRADED (downstream pipeline stale — expected pre-deploy) |

## Full deploy

| Item | Value |
|---|---|
| Target SHA | `b4188980292b8c0705461bc3b91a126fc0f7f307` (current main) |
| Deploy run ID | 27094264485 |
| Deploy status at proof capture | in_progress |
| Deploy includes | UTV2-1011 freshness fix, Wave-5 scoring, Wave-7 evidence, all recent governance |

Full deploy pending completion. Once complete, re-run `pnpm stage:freshness` to confirm downstream pipeline (Market Universe, Candidates, Scoring, Board) recovers.

## Secret exposure check

No secret values appear in this document, in `evidence.json`, in `freshness-report.json`, or in any committed file. Workflow logs mask all secrets via GitHub Actions `***` substitution.
