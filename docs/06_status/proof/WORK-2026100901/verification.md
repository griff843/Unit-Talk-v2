# PROOF: WORK-2026100901

MERGE_SHA: pending merge

Issue: WORK-2026100901
Tier: T1
result: STATIC_PASS_RUNTIME_DEFERRED

## ASSERTIONS:

- [x] `/health` treats an unreadable zombie check as `unknown`, returns degraded status, and uses HTTP 503.
- [x] Authorized, delivery-eligible human-capper picks in delivery lifecycle states are checked against their actual `discord:official-picks` target.
- [x] Database candidate reads filter and paginate only promoted/non-null-target rows or authorized delivery-eligible human-capper rows; they do not scan the full draft/validated population.
- [x] Track Only, voided/settled, fixture, and live-killed-target picks are explicitly excluded or classified without becoming actionable zombies.
- [x] Existing promoted canary/best-bets health behavior is preserved.
- [x] `discord:official-picks` remains excluded from replay; readiness and receipt-freshness behavior are unchanged from `origin/main`.
- [x] The implementation adds read-only persistence reads only; no schema, migration, dependency, endpoint, network integration, production write, or production-state mutation was introduced.

## EVIDENCE:

Verified source snapshot (after refreshing from `origin/main`):

```text
bc4ff73c7f75a2e6184a247cfb2358ae318668e8
```

Implementation change commit:

```text
892634bf61b91806f8a888ab475308f91b015a0a
```

Rework provenance:

```text
epoch: d90e2156-c6ac-49e6-8b96-dbdad1487d2a
mode: rework
reviewed baseline: 98244597b819fb7c53c81b6867aeb279fc3ae48b
owner/PM verdict: CHANGES_REQUIRED (second rework)
result: health-only implementation retained; database candidate filtering moved ahead of pagination
```

Focused regression and mutation-style controls:

```text
pnpm exec tsx --test apps/api/src/server.test.ts
tests 66; pass 66; fail 0; skipped 0

pnpm exec tsx --test 'apps/worker/src/replay-failed-delivery.test.ts' 'scripts/ops/pipeline-health-classification.test.ts' 'scripts/ops/readiness-refresh.test.ts'
tests 93; pass 93; fail 0; skipped 0

pnpm exec tsx --test 'apps/api/src/server.test.ts' 'apps/worker/src/replay-failed-delivery.test.ts' 'scripts/ops/pipeline-health-classification.test.ts' 'scripts/ops/readiness-refresh.test.ts'
tests 159; pass 159; fail 0; skipped 0 (exact refreshed source snapshot)
```

The health suite dynamically restores main's healthy zombie-check fallback and removes the killed-target guard. Those mutants report the wrong health dimension or count the deliberately held official-picks candidate, demonstrating that both guards are load-bearing. The authorized human-capper regression uses the real in-memory repository method and fails on current main because that repository omits human candidates.

The second-rework mutation removed the promoted-status/non-null-target filters and both human metadata filters from the database repository. `apps/api/src/server.test.ts` then exited 1 with 65 pass / 1 fail; restoring those four filters returned the suite to 66/66. The failing query-shape regression is therefore load-bearing and would catch a return to paging the full lifecycle population.

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
- Required focused three-file command — PASS, 93/93; combined exact-head focused command — PASS, 159/159.
- `pnpm exec tsx --test apps/api/src/server.test.ts` — PASS, 66/66; DB-filter mutant 65/66 with the query-shape regression failing.
- `pnpm verify:static` — PASS.
- `pnpm verify` — static PASS; writable staging phase BLOCKED/DEFERRED by the target-identity guard.
- `pnpm test:db` — BLOCKED/DEFERRED by the same staging target guard before access.
- Read-only runtime proof — unavailable locally and reported failing closed.
- R-level check — PASS; no matching artifact rule.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1728
Execution SHA: bc4ff73c7f75a2e6184a247cfb2358ae318668e8
