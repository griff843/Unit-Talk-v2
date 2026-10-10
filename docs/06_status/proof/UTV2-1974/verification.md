# PROOF: UTV2-1974

MERGE_SHA: pending merge
Issue: UTV2-1974
Tier: T2
result: incomplete
Execution baseline: 03f16e279ed4ba34f2f6f603a1f28dba1e2413bc, plus the reviewed two-file implementation diff.

## ASSERTIONS:
- [x] Add apps/web to the existing delivery-ui app registry.
- [x] Focused test accepts web and refuses mixed/unknown scopes.
- [x] No concurrency caps, tiers, singletons, merge locks, runtime or deployment behavior changed.
- [ ] Full verification including sanctioned staging DB checks.
- [ ] Exact-head CI and required provenance.

## EVIDENCE:
- Regression inversion: pnpm exec tsx --test --test-name-pattern="public website" scripts/ops/shared.test.ts: exit 1 before implementation, expected admission failure.
- Focused suite: pnpm exec tsx --test scripts/ops/shared.test.ts: exit 0, 136 passed, 0 failed.
- pnpm verify: exit 1. Static stages passed (boundary, sync, alignment, env, lint, type-check, build, tests, Smart Form verification, command/migration checks). Live DB phase refused an unidentified local target; no writable DB test ran.
- Raw captured logs: .out/web-admission-red-test.log, .out/web-admission-green-test.log, .out/web-admission-verify.log.
- Staging CI is the required next proof source. Local refusal is not a passing full gate.
- Browser QA is not applicable to this tooling-only correction.

## Verification
```
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 137 migration file(s) verified — no duplicate versions.
[lint-migrations] 136 migration file(s) checked — no findings.
> test:live-db
> test:db
> ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL. Run through staging-ci with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
```

## Merge SHA Binding
Merge SHA: pending merge
PR: pending
