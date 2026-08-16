# PROOF: UTV2-1611

MERGE_SHA: 6b2c76747a368a45e42b9788cc665a852e525fca

> Pre-merge this anchor carries the verified branch-head SHA. The authoritative
> merge SHA does not exist yet; post-merge closeout must rebind this artifact.

Generated at: 2026-08-16T16:27:02Z
Issue: UTV2-1611
Tier: T1
Lane type: runtime
Branch: codex/utv2-1611-automated-write-boundary
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1427
Verified implementation source: 6b2c76747a368a45e42b9788cc665a852e525fca
Pre-proof branch head: 6b2c76747a368a45e42b9788cc665a852e525fca
Result: static implementation verified; completion blocked on an authorized live-DB proof path and staging receipt

## ASSERTIONS:

- [x] System-generated board and candidate-scanner submissions are created directly in `awaiting_approval` without a transient `validated` state.
- [x] A synthetic future producer marked `systemGenerated` is governed without source allowlist membership, and adding a valid `PickSource` requires an explicit compile-time policy classification.
- [x] Missing or stale current market evidence fails closed before the producer invokes submission persistence.
- [x] Scheduler/enablement flags grant execution only and cannot approve or release an automated pick.
- [x] Producer, transition actor/reason, snapshot timestamp, and snapshot age are recorded as boundary provenance.
- [x] A readiness helper mechanically detects any marked automated producer, including the synthetic future source, observed in `validated`.
- [x] Manual and operator submission behavior remains on the existing `validated` path.
- [ ] Writable Postgres behavior is not claimed locally; the authoritative exact-head receipt must come from staging project `xskgrzbteyqdufktjrjx`.

## EVIDENCE:

## Verification

- [x] `pnpm verify:static`: PASS on rebased head, including `pnpm type-check`, build, canonical `pnpm test`, lint, environment checks, automation coverage, and command/migration checks.
- [x] `pnpm exec tsx --test 'apps/api/src/automated-write-boundary.test.ts' 'apps/api/src/board-pick-writer.test.ts' 'apps/api/src/candidate-pick-scanner.test.ts'`: PASS, 39/39.
- [x] `pnpm exec tsx --test apps/api/src/submission-service.test.ts`: PASS, 73/73.
- [x] `pnpm exec tsx --test apps/api/src/settlement-service.test.ts`: PASS, 25/25.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; matched `lifecycle-fsm`; R4 fault report is PM-gated advisory.
- [x] `git diff --check`: PASS.
- [x] `pnpm ops:automation-coverage-check`: PASS; the boundary cases are registered through the canonical candidate-scanner suite.

```text
$ pnpm verify:static
exit 0

$ pnpm exec tsx --test 'apps/api/src/automated-write-boundary.test.ts' 'apps/api/src/board-pick-writer.test.ts' 'apps/api/src/candidate-pick-scanner.test.ts'
1..39
# tests 39
# pass 39
# fail 0
# skipped 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 12
Rules matched: lifecycle-fsm
Advisory (PM-gated) artifacts missing: r4-fault-report
```

## Runtime Verification

The focused tests execute the real submission service against the in-memory
repository bundle and exercise both automated producer loops. They demonstrate
the initial lifecycle decision, fail-closed evidence checks, provenance, and
manual-path preservation. The rework regression also proves that a synthetic
future producer marked `systemGenerated` cannot bypass the boundary solely
because its source is absent from a historical allowlist.

`pnpm test:db` was attempted locally. The staging guard stopped execution before
any writable test or database mutation:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with
`CI_SUPABASE_*` credentials.

No production credentials were sourced or copied. No Supabase project, stranded
row, scanner flag, deployment, or public distribution target was mutated.

## Stop Condition

The repository Proof Coverage Guard requires a live-DB proof case under an
accepted T1 proof-test path because `submission-service.ts` changed. This lane's
allowed file list contains no accepted live-DB proof path. Adding one or applying
an infrastructure-only skip label would exceed the packet's authority. The lane
therefore requires scope expansion plus a staging-CI exact-head receipt before
it can satisfy the T1 proof gate.

The Return Review Packet also requires direct package-script wiring for the new
`automated-write-boundary.test.ts` file. The suite is registered through
`candidate-pick-scanner.test.ts` and executes under `pnpm verify:static`, but the
mechanical wiring gate still fails and `package.json` is outside the allowed
file scope. That correction likewise requires an explicit scope expansion.

## SHA Binding

Head SHA: 6b2c76747a368a45e42b9788cc665a852e525fca
Merge SHA: N/A — post-merge closeout responsibility
