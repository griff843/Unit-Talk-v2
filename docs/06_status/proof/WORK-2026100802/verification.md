# PROOF: WORK-2026100802

MERGE_SHA: pending merge

Issue: WORK-2026100802
Tier: T1
Lane type: governance
Execution SHA: `4f75b0017512e86737a9c59892a7673dfe9536da`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1727
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] Push extraction recognizes bounded UTV2, UNI, and WORK IDs from the merge message or PR branch,
      normalizes case, preserves first-message precedence, and rejects embedded look-alikes.
- [x] The merge-SHA rebinder accepts exactly `<br>`, `<br/>`, and `<br />` after an existing
      placeholder and preserves the suffix without accepting other trailing text.
- [x] Ordinary push generation and GitHub-attested manual recovery bind `diff-summary.md`; recovery
      also binds verification, evidence, and model-routing artifacts and clears P3/C4.
- [x] Wrong PR identity, wrong or unreachable merge SHA, cross-merge replay, conflicting immutable
      routing authority, fenced evidence, and unbindable authored proof remain refusals.
- [x] No branch-protection, required-check, merge gate, truth-check, runtime, schema, product, or
      direct-main mutation path changed.

## EVIDENCE:

Focused regression result:

```text
pnpm exec tsx --test 'scripts/ops/lane-close.test.ts' 'scripts/ops/proof-generate.test.ts'
tests 302
pass 302
fail 0
duration_ms 9206.532368
```

The focused suite includes the literal workflow shell block, all three ID families, no-match and
ambiguous inputs, the ordinary push generator, the attested WORK recovery path, P3/C4 evaluation,
all three admitted line-break suffixes, authored/fenced/look-alike refusals, wrong PR/SHA/reachability
controls, and the cross-merge guard.

## Verification

- [x] `pnpm verify:static`: exit 0. This ran sync/alignment/automation checks, environment validation,
      lint, type-check, build, the full test matrix, production post-migration tests, Smart Form
      verification, command-manifest validation, and migration checks.
- [x] `pnpm type-check`: passed through `pnpm verify:static`.
- [x] `pnpm test`: passed through `pnpm verify:static`; the ops aggregate reported 3,672 pass and
      zero fail, including the new WORK closeout regressions.
- [ ] `pnpm test:db`: executed and refused before DB access by the staging-target guard:
      `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx`. Writable DB verification is
      blocked/deferred to the protected `staging-ci` GitHub environment with `CI_SUPABASE_*`.
- [ ] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: pending the final
      proof commit so the receipt evaluates the exact review head.
- [ ] Protected exact-head CI/staging receipts: pending the final proof push; not claimed locally.
- [ ] PM approval, governed merge, self-closure, and trusted WORK-2026100801 closeout are authorized
      post-executor steps and are not claimed by this draft review candidate.

No production database or deployment was accessed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1727
Execution SHA: 4f75b0017512e86737a9c59892a7673dfe9536da
