# PROOF: WORK-2026100302

MERGE_SHA: pending merge

Measured control-plane proof. No product behavior or branding implementation changed.

Issue: WORK-2026100302
Tier: T1
result: static_pass_live_db_blocked_by_containment

## ASSERTIONS:

- [x] WORK and UTV2 overrides parse in the documented field orders.
- [x] Actual workflow collector rejects unauthorized users, bots, missing authors, malformed IDs, schema mismatch, missing SHA/paths, and malformed PR.
- [x] Guard rejects wrong issue, PR, HEAD, unlisted paths, and overlapping active lanes.
- [x] Authoritative merged-lane repair releases the old lock without changing scope guard implementation.

## EVIDENCE:

```text
pnpm exec tsx --test scripts/ci/scope-override-comment-parser.test.ts scripts/ci/file-scope-guard.test.ts
# tests 63
# pass 63
# fail 0
# skipped 0

pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) - no R-level artifacts required for this diff

FILE_SCOPE_PR_BRANCH=codex/work-2026100302-scope-override pnpm exec tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --manifest-source git
No file scope lock conflicts or scope violations detected.
```

Generated repair packet applied with `ops:lane-repair-packet apply`; live GitHub
merge authority and unchanged input/candidate hashes validated. PR #1709 merge SHA:
`771b761b74cef6d44eb9a0cd1f8649061e4735b5`. The lane is repaired to merged,
not declared done; no unexecuted truth-check is claimed as passing.

## Verification

- `pnpm verify`: complete static chain passed, including lint, type-check, build,
  full tests, production-post-migration static tests, Smart Form verification,
  command manifest, and migration lint. Live DB portion exited 1 at containment.
- `pnpm test:db`: exited 1 before DB suites/writes at the same containment guard.
- Automation coverage PASS, no newly unwired tests. Existing shadowed QA glob warning retained.
- `git diff --check`: PASS.

```text
> test:live-db
> pnpm test:db && pnpm test:t1-proof:live
> ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Exact-head GitHub T1 staging CI remains required. Local containment is not a
product defect or a passing live-DB proof. Activation and external override posting
remain pending normal review/merge controls. PR #1711 is paused.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1712
Execution SHA: 32b80821edcefd24fe3507f91eaec32d9ed1ee70
