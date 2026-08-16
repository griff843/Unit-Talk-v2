# PROOF: UTV2-1611

MERGE_SHA: 9881ea3c9e992edf33ac86b317742fdc96a0f91e

> Pre-merge this anchor carries the verified branch-head SHA. The authoritative
> merge SHA does not exist yet; post-merge closeout must rebind this artifact.

Generated at: 2026-08-16T15:35:15.762Z  
Issue: UTV2-1611  
Tier: T1  
Lane type: runtime  
Branch: codex/utv2-1611-automated-write-boundary  
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1427  
Verified implementation source: 66c4cfd165e920caeb4368201362f5a5512f66f3  
Pre-proof branch head: 9881ea3c9e992edf33ac86b317742fdc96a0f91e  
Result: implementation verified; writable DB proof blocked/deferred to staging CI

## ASSERTIONS:

- [x] System-generated board and candidate-scanner submissions are created directly in `awaiting_approval` without a transient `validated` state.
- [x] Missing or stale current market evidence fails closed before the producer invokes submission persistence.
- [x] Scheduler/enablement flags grant execution only and cannot approve or release an automated pick.
- [x] Producer, transition actor/reason, snapshot timestamp, and snapshot age are recorded as boundary provenance.
- [x] A readiness helper mechanically detects any system-generated board/scanner pick observed in `validated`.
- [x] Manual and operator submission behavior remains on the existing `validated` path.
- [ ] Writable Postgres behavior is not claimed locally; the authoritative exact-head receipt must come from staging project `xskgrzbteyqdufktjrjx`.

## EVIDENCE:

## Verification

- [x] `pnpm verify:static`: PASS on rebased head, including `pnpm type-check`, build, canonical `pnpm test`, lint, environment checks, automation coverage, and command/migration checks.
- [x] `pnpm exec tsx --test 'apps/api/src/automated-write-boundary.test.ts' 'apps/api/src/board-pick-writer.test.ts' 'apps/api/src/candidate-pick-scanner.test.ts'`: PASS, 38/38.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; matched `lifecycle-fsm`; R4 fault report is PM-gated advisory.
- [x] `git diff --check`: PASS.
- [x] `pnpm ops:automation-coverage-check`: PASS; the boundary cases are registered through the canonical candidate-scanner suite.

```text
$ pnpm verify:static
exit 0

$ pnpm exec tsx --test 'apps/api/src/automated-write-boundary.test.ts' 'apps/api/src/board-pick-writer.test.ts' 'apps/api/src/candidate-pick-scanner.test.ts'
1..38
# tests 38
# pass 38
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
manual-path preservation without starting the API, scheduler, or a database
connection.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with
`CI_SUPABASE_*` credentials.

No production credentials were sourced or copied. No Supabase project, stranded
row, scanner flag, deployment, or public distribution target was mutated.

## SHA Binding

Head SHA: 9881ea3c9e992edf33ac86b317742fdc96a0f91e  
Merge SHA: N/A — post-merge closeout responsibility
