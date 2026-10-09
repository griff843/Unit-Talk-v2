# PROOF: WORK-2026100901

MERGE_SHA: pending merge

Issue: WORK-2026100901
Tier: T1
result: STATIC_PASS_RUNTIME_DEFERRED

## ASSERTIONS:

- [x] `/health` treats an unreadable zombie check as `unknown`, returns degraded status, and uses HTTP 503.
- [x] Authorized, delivery-eligible human-capper picks in delivery lifecycle states are checked against their actual `discord:official-picks` target.
- [x] Track Only, voided/settled, fixture, and live-killed-target picks are explicitly excluded or classified without becoming actionable zombies.
- [x] Existing promoted canary/best-bets health behavior is preserved.
- [x] `discord:official-picks` remains excluded from replay; readiness and receipt-freshness behavior are unchanged from `origin/main`.
- [x] The implementation adds read-only persistence reads only; no schema, migration, dependency, endpoint, network integration, production write, or production-state mutation was introduced.

## EVIDENCE:

Implementation source commit:

```text
2cf71252cb50cd4f1bcba12b562a5c2ae2f4290b
```

Rework provenance:

```text
epoch: d70b4dc6-5a59-4991-8478-a35c87eb090c
mode: rework
reviewed baseline: 6336402a0fcc829b5dbaa19dfd9444a6bc212547
owner/PM verdict: CHANGES_REQUIRED
result: health-only implementation retained; replay/readiness/freshness changes reverted
```

Focused regression and mutation-style controls:

```text
pnpm exec tsx --test apps/api/src/server.test.ts
tests 65; pass 65; fail 0; skipped 0

pnpm exec tsx --test 'apps/worker/src/replay-failed-delivery.test.ts' 'scripts/ops/pipeline-health-classification.test.ts' 'scripts/ops/readiness-refresh.test.ts'
tests 93; pass 93; fail 0; skipped 0
```

The health suite dynamically restores main's healthy zombie-check fallback and removes the killed-target guard. Those mutants report the wrong health dimension or count the deliberately held official-picks candidate, demonstrating that both guards are load-bearing. The authorized human-capper regression uses the real in-memory repository method and fails on current main because that repository omits human candidates.

The restored three-file suite asserts that official-picks is not an accepted replay target and that `--target all` never replays it. `git diff origin/main` contains no replay, readiness, pipeline-health, classification-helper, or generated readiness-score path.

Static gate and R-level receipt:

```text
pnpm type-check
exit 0

pnpm verify:static
exit 0

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

Writable staging proof is intentionally deferred, not bypassed:

```text
pnpm verify
verify:static completed successfully; test:live-db stopped at ci:assert-staging
exit 1
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).

pnpm test:db
exit 1 before database access
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
```

Required follow-up: run writable DB verification through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials for project `xskgrzbteyqdufktjrjx`.

Read-only runtime proof fails closed in this environment:

```text
pnpm pipeline:health
exit 1
heartbeat query failed: TypeError: fetch failed
outbox query failed: paged read failed at offset 0: TypeError: fetch failed
```

No live row count is claimed, no canonical readiness artifact was changed, and no production write was attempted.

## Verification

- `pnpm type-check` — PASS.
- Required focused three-file command — PASS, 93/93.
- `pnpm exec tsx --test apps/api/src/server.test.ts` — PASS, 65/65.
- `pnpm verify:static` — PASS.
- `pnpm verify` — static PASS; writable staging phase BLOCKED/DEFERRED by the target-identity guard.
- `pnpm test:db` — BLOCKED/DEFERRED by the same staging target guard before access.
- Read-only runtime proof — unavailable locally and reported failing closed.
- R-level check — PASS; no matching artifact rule.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1728
Execution SHA: 2cf71252cb50cd4f1bcba12b562a5c2ae2f4290b
