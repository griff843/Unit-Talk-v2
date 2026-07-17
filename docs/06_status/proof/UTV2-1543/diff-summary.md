# UTV2-1543 Diff Summary

Issue: UTV2-1543
Tier: T1
Lane type: governance
Branch: `claude/utv2-1543-bind-t1-pm-verdicts-to-exact-head-sha`

## Changes

- `.github/workflows/merge-gate.yml` — T1's PM-verdict validation now delegates
  to `scripts/ops/merge-gate-verdict.cjs`'s `validateT1Verdicts`, which requires
  the latest `APPROVED` verdict's `PR:` and `Head SHA:` fields to match the
  live PR number and current head SHA exactly. Stale, missing, malformed,
  mismatched, or bot-authored verdicts fail closed. `CHANGES_REQUIRED` verdicts
  and the existing bounce-limit behavior are unchanged.
- `scripts/ops/merge-gate-verdict.cjs` (new) — pure `parseVerdict` and
  `validateT1Verdicts` functions, plain CommonJS so `actions/github-script` can
  `require()` it directly from the checked-out workspace (matches the
  precedent already used in this workflow file for `/tmp/r-level-result.json`
  and the built-in `require('fs')` calls).
- `scripts/ops/merge-gate-verdict.test.ts` (new) — 16 tests covering all 7
  acceptance criteria from the issue, plus bot-author/non-CODEOWNERS/no-verdict/
  bounce-limit/verdict-supersession edge cases.
- `scripts/ops/workflow-hardening.test.ts` — asserts merge-gate.yml resolves T1
  verdict validation via the tested module (not a duplicated inline
  implementation), and that a verdict bound to a different head SHA fails
  closed.
- `docs/05_operations/schemas/pm-verdict-v1.md` — documents `PR:` and
  `Head SHA:` as required fields for an APPROVED verdict, and the new
  validation rule.
- `eslint.config.mjs` — adds a `**/*.cjs` override (Node globals, CommonJS
  source type) since this is the repo's first `.cjs` file.

## Explicitly not changed

- T2 pm-verdict/executor-result/PR-review validation paths.
- Bounce-limit semantics (still 3 CHANGES_REQUIRED verdicts trips it).
- Any branch-protection or repository ruleset setting.
