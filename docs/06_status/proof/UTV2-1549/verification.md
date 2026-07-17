# PROOF: UTV2-1549

MERGE_SHA: 810046e413b5b90e3d8339774c157a829f277f08

Pre-merge proof, bound to the current PR head SHA above (not yet an actual
merge commit — the merge SHA does not exist until governed post-merge
truth-close binds it, per `EXECUTION_TRUTH_MODEL.md`).

# UTV2-1549 Verification

## ASSERTIONS:

- [x] Live Supabase verification captured for `ingestor.cycle`, `worker.heartbeat`, `provider_offer_history`, `game_results`, and settled picks in `runtime-health.json`
- [x] Queue readiness counts captured and classified per `QUEUE_READINESS_SEMANTICS.md` v1.0
- [x] Readiness ledger honestly regenerated as `RED` (no readiness claim made)
- [x] `pnpm verify` PASS, `pnpm test:db` PASS (7/7), R-level check PASS
- [x] No restart, mutation, deploy, or beta-activation action taken by this lane

## Acceptance criteria

- Live Supabase verification: captured read-only latest-row evidence for `ingestor.cycle`, `worker.heartbeat`, `provider_offer_history`, `game_results`, and settled picks in `runtime-health.json`.
- Queue readiness: captured exact PostgREST counts and classified them under `QUEUE_READINESS_SEMANTICS.md` v1.0. The snapshot contains 2,406 governance-held rows, zero retryable rows, zero non-governance stale claims, and one true delivery failure.
- Deploy alignment: GitHub Actions deploy run `28415953590` deployed `8deccace`; current `origin/main` was `1e2d4af5`, 285 commits ahead.
- Honest regeneration: readiness remains `RED`, with deploy alignment, ingestion, outbox health, and dead-letter health blocking.
- Findings: the continuing ingestion/deploy incident remains tracked by UTV2-1477. The true delivery failure and fresh-settlement/stale-result contradiction are explicitly recorded for UTV2-1549 closeout; no repair or restart was attempted.

## EVIDENCE:

## Verification

Substantive runtime-truth snapshot commit (pre-rebase original): `a3475a3d2782db08174fd422d828df1321054f60`.

- `pnpm ops:brief` — completed; supplied an independent product-truth and queue overview.
- `pnpm pipeline:health` — returned CRITICAL, identifying one true dead-letter failure. Its raw list queries are capped at 1,000 rows, so exact counts in `runtime-health.json` come from separate `Prefer: count=exact` read-only PostgREST requests.
- `pnpm exec tsx scripts/worker-alert-check.ts` — PASS at observation time; latest heartbeat was within its 120-minute threshold.
- `pnpm exec tsx scripts/ops/ingestor-health-check.ts` — inconclusive because its query references nonexistent `provider_offers.updated_at`; direct live queries provide the issue-required evidence instead.
- `pnpm test:db` — PASS; database smoke suite completed with 7 passing tests, zero failures, and zero skips.

```text
> pnpm test:db
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```

- `pnpm verify` — PASS; static verification, DB smoke (7/7), and the complete live T1 proof suite completed with zero failures. The bounded-dedup content assertion had one expected skip because the latest provider snapshot is outside the 72-hour window; that skip is runtime outage evidence and is recorded in `runtime-health.json`, not treated as a code pass for ingestion freshness.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R-level rules matched the readiness/proof-only changed paths.

## Scope and authority

This lane performed only read-only runtime checks and edited only its manifest-scoped readiness/proof files. It did not restart services, mutate production data, deploy code, approve itself, or make a paid-beta activation claim.
