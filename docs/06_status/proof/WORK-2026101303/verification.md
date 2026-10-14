# PROOF: WORK-2026101303

MERGE_SHA: pending merge

Issue: WORK-2026101303
Tier: T1
Lane type: runtime
Branch: codex/work-2026101303-grading-validated-read
result: pending_exact_head_ci_and_independent_pm_review

## ASSERTIONS:

- [x] `runGradingPass` reads `validated` picks through `PickRepository.listTrackOnlyByLifecycleState` when the repository provides it, and through the existing paged `listByLifecycleState` reader otherwise.
- [x] The graded population for a mixed validated set (Track Only, delivery-eligible, no mode) is unchanged: only Track Only rows reach grading; `restrictToPickIds` and `rowsScanned` semantics are asserted in the new test.
- [x] The fallback path (repository without the new method) is tested and behaves as before.
- [x] The in-JS `isEvidencePlanePick` filter remains as a backstop, so the narrowed read can only remove candidates.
- [x] `posted` and `awaiting_approval` reads, `listByLifecycleState`, settlement and delivery code are untouched; no migration, index, fixture deletion or timeout change.
- [ ] The writable staging proof (`Writable DB proof (staging only)`) must pass on the first attempt at the exact head in the sanctioned `staging-ci` environment. This is the lane's acceptance criterion for the statement-timeout failure and has NOT been demonstrated locally.
- [ ] Independent PM T1 review must approve this exact head (`t1-approved` plus `pm-verdict/v1`).

## EVIDENCE:

Code commit: `bc679de4e3dfc46cb1a78ebbc6aa3ce83b758313` (later commits touch only proof and model-routing metadata). All commands below ran in the lane worktree at HEAD `d6dabe87e30dddebb4cc338bb9e35ea52cbabe57`, which has the same implementation files as the code commit.

Focused grading suites:

```text
pnpm exec tsx --test apps/api/src/grading-cron.test.ts apps/api/src/grading-service.test.ts
exit 0
tests 115
pass 115
fail 0
cancelled 0
skipped 0
```

Local T1 database containment:

```text
pnpm test:db
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
exit 1
```

The writable DB proof is refused locally by design and delegated to exact-head `staging-ci`. No local green `pnpm verify` or `pnpm test:db` is claimed.

Database read shape (from code, not executed against a database by this executor): `picks` filtered `status = <state>` and `metadata->>distributionMode = 'track-only'`, ordered `created_at, id`, paged with `readAllOrderedPages`. The baseline population counts in `evidence.json` are the PM read-only staging measurement quoted in the work order, not re-measured here.

R-level compliance:

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 10
Rules matched: (none) — no R-level artifacts required for this diff
exit 0
```

## Verification

- `pnpm exec tsx --test apps/api/src/grading-cron.test.ts apps/api/src/grading-service.test.ts` — PASS, 115/115, exit 0.
- `pnpm verify:static` — PASS, exit 0 (db-client-boundary, sync-check, system-alignment, automation-coverage, env-check, lint, type-check, build, test, production-post-migration, smart-form verify, verify:commands).
- `pnpm type-check` — PASS, exit 0.
- `pnpm test:db` — REFUSED by the staging identity guard, exit 1; delegated to exact-head `staging-ci`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no matching R-level rule.
- `git diff --check origin/main...HEAD` — PASS, exit 0.

## STOP CONDITIONS ENCOUNTERED:

- Writable live-DB proof cannot run locally because the configured host resolves to loopback rather than sanctioned staging project `xskgrzbteyqdufktjrjx`; exact-head CI must supply it.
- No push, merge, deployment, production mutation, Discord mutation, pick change, delivery release or lane finalization was performed by this proof step.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1754
Execution SHA: bc679de4e3dfc46cb1a78ebbc6aa3ce83b758313
