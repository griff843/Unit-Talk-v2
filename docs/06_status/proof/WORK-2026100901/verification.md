# PROOF: WORK-2026100901

MERGE_SHA: pending merge

Issue: WORK-2026100901
Tier: T1
result: STATIC_PASS_RUNTIME_DEFERRED

## ASSERTIONS:

- [x] Replay admits `discord:official-picks` and includes it in `--target all`.
- [x] Replay refuses sent-receipt, delivered-ledger, and ambiguous-ledger rows for canary, best-bets, and official-picks; explicit reconciliation is written before reset.
- [x] `/health` returns degraded/503 when zombie evidence is unreadable, covers authorized human-capper delivery, and excludes Track Only, voided, fixture, and killed-target picks.
- [x] Readiness detects actionable never-claimed pending rows while classifying the two voided official-picks rows and 32 unclaimable canary processing rows as non-gating.
- [x] Pipeline freshness ignores non-`sent` receipts.
- [x] All new production reads are read-only; no schema, migration, dependency, endpoint, or production write was introduced.

## EVIDENCE:

Implementation source commit:

```text
bb0f4973929055edfc35a8a3d1dba1fac02cef8c
```

Focused regression and mutation-style controls:

```text
pnpm exec tsx --test 'apps/worker/src/replay-failed-delivery.test.ts' 'scripts/ops/pipeline-health-classification.test.ts' 'scripts/ops/readiness-refresh.test.ts'
tests 112; pass 112; fail 0; skipped 0

pnpm exec tsx --test apps/api/src/server.test.ts
tests 64; pass 64; fail 0; skipped 0
```

The suites exercise the load-bearing guards directly: deleting replay duplicate checks, the zombie unknown/killed/Track Only exclusions, the never-claimed classification, or the sent-only receipt filter makes the corresponding regression fail. The health suite also removes named guard blocks at runtime for killed-target and Track Only inversion controls.

Static gate and R-level receipt:

```text
pnpm verify:static
exit 0

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 14
Rules matched: lifecycle-fsm
```

Writable staging proof is intentionally deferred, not bypassed:

```text
pnpm verify
all verify:static stages passed; test:live-db stopped at ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).

pnpm test:db
same staging-only refusal; exit 1 before any database test or write
```

Required follow-up: run writable DB verification through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials for project `xskgrzbteyqdufktjrjx`.

Read-only runtime probes fail closed in this environment:

```text
pnpm pipeline:health
heartbeat query failed: TypeError: fetch failed
outbox query failed: paged read failed at offset 0: TypeError: fetch failed

pnpm ops:readiness-refresh -- --out /tmp/WORK-2026100901-readiness.json --json
exit 0; worker_outbox_health=unknown
reason: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not present; not scored as passing
```

No canonical readiness artifact or live row was changed; the readiness output was directed to `/tmp`.

## Verification

- `pnpm type-check` — PASS.
- Required focused three-file command — PASS, 112/112.
- `pnpm exec tsx --test apps/api/src/server.test.ts` — PASS, 64/64.
- `pnpm verify:static` — PASS.
- `pnpm verify` — static PASS; writable staging phase BLOCKED by target identity guard.
- `pnpm test:db` — BLOCKED/DEFERRED by the same staging target guard.
- Read-only runtime proof — UNAVAILABLE locally and reported unknown/failing closed.
- R-level check — PASS (`lifecycle-fsm`).

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: bb0f4973929055edfc35a8a3d1dba1fac02cef8c
