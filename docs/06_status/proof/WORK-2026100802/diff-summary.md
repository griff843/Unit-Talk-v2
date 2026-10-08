# WORK-2026100802 Diff Summary

Execution SHA: `4f75b0017512e86737a9c59892a7673dfe9536da`
Diff base: `fbcc25985e469d82f1ebd338f8e066fc7cec5729` (`origin/main`)
PR: https://github.com/griff843/Unit-Talk-v2/pull/1727

## What changed

- `.github/workflows/post-merge-lane-close.yml` now extracts the first bounded, canonical
  `UTV2-<n>`, `UNI-<n>`, or `WORK-<n>` token from the merge message, then falls back to the PR
  branch. Matching remains case-insensitive and output is normalized to upper case.
- `scripts/ops/proof-generate.ts` accepts only `<br>`, `<br/>`, or `<br />` after an existing
  placeholder on a labelled merge-SHA line and preserves that suffix when it writes the
  authoritative merge SHA.
- Existing GitHub PR identity, merge reachability/ownership, cross-merge divergence, immutable
  model-routing binding, merge-mutex, direct-main, and partial-rebind refusal controls are unchanged.
- Existing test files execute the workflow's literal shell block and exercise ordinary push binding,
  attested manual WORK recovery, full P3/C4 artifact coverage, and negative placeholder cases.

## Measured defects and after-state

- Before: the literal push script contained only `UTV2-\d+`; run `37833846230` skipped every later
  closeout step for a merged WORK lane. After: literal-script cases for WORK, UNI, UTV2, no match,
  embedded look-alikes, and multiple IDs all pass.
- Before: the anchored placeholder matcher rejected `Merge SHA: pending merge<br>`; dispatch run
  `37836968538` could not bind `diff-summary.md`, leaving P3/C4 red. After: all three exact line-break
  forms bind through the push generator, and attested WORK recovery binds all four declared proof
  artifacts with P3/C4 clear.

## Files changed

- `.github/workflows/post-merge-lane-close.yml`
- `scripts/ops/proof-generate.ts`
- `scripts/ops/proof-generate.test.ts`
- `scripts/ops/lane-close.test.ts`
- `.ops/sync/WORK-2026100802.yml`
- `docs/06_status/lanes/WORK-2026100802.json`
- `docs/06_status/proof/WORK-2026100802/*`

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1727
