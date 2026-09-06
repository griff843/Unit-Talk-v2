# PROOF: UTV2-1688

MERGE_SHA: pending merge
Execution SHA: b2cfd6d2132e8f1e07510e4afb3b148939f5c8d4

Recognize the `bootstrap/` branch namespace in the executor-result validator, in both copies of its
field-validation rules, and make the duplication self-policing.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is the last non-proof commit on
the branch; everything after it touches only `docs/06_status/proof/UTV2-1688/` and
`docs/06_status/lanes/UTV2-1688.json`. The binding is written after merge by
`ops:proof-generate --merge-sha`; no manual append is made here.

## Summary

`Executor Result Validation` is one of four required contexts on `main`, and it is created **only**
by an `EXECUTOR_RESULT` comment. Its `Branch:` field was validated against
`/^(claude|codex)\/(utv2|uni)-\d+/i`, which does not recognize the `bootstrap/` namespace. Both
possible spellings therefore failed — `bootstrap/...` as an invalid branch, `claude/...` as a
mismatch against the real head ref — so no valid executor result could be written for a bootstrap
lane, the required context could never be created, and every such lane was permanently unmergeable
without an admin bypass.

The rules are duplicated: once in `scripts/ops/executor-result-validate.ts` and once inline in
`.github/workflows/executor-result-validator.yml`, because an `actions/github-script` `script:`
block is a YAML string and cannot import a TypeScript module. **The inline copy is the one that
gates merges** — see A2. This lane widens both, and adds two tests that read the workflow and
assert its literals are byte-identical to the exported ones, so the pair cannot drift again.

Lane type governance, tier T2, executor claude.

## Verification

`pnpm type-check` and `pnpm test` were run in the lane worktree. `pnpm verify` cannot exit 0 on a
developer machine; see the note under EVIDENCE for what that means and what is claimed instead.

ASSERTIONS:

- [x] **A1 — The defect is real, and was measured by executing the validator rather than reading
  the regex.** `parseExecutorResultComment` + `validateExecutorResultFields` from *`origin/main`'s
  copy of the script*, against a bootstrap executor result whose `Branch:` equals its head ref,
  returns `Invalid branch: "bootstrap/utv2-1619-…"`. The same probe against this lane's copy returns
  zero errors. Output under EVIDENCE.
- [x] **A2 — The copy that gates merges is the inline one, and it was measured separately.**
  `grep -rn "validateExecutorResultFields"` across the repository returns exactly two consumers: the
  function's own definition and `scripts/ops/executor-result-validate.test.ts`. The workflow invokes
  the script only for `resolve-check-name` (`executor-result-validator.yml:103`). So a proof that
  exercised only the module would say nothing about the gate. The inline `branchRe` literal was
  therefore extracted from both `origin/main`'s workflow and this lane's and evaluated directly:
  `false` before, `true` after, on the same branch string.
- [x] **A3 — The `Branch: == PR head ref` binding is preserved.** Deleting that check makes
  `UTV2-1688 control: a bootstrap/ branch that disagrees with the PR head is still rejected` fail;
  restoring it returns the suite to green. This is the acceptance criterion the issue calls out
  explicitly, and it is shown failing on the condition it names rather than merely passing.
- [x] **A4 — The PR-number and head-SHA bindings are preserved.** A stale head SHA on a
  `bootstrap/` branch still produces `HEAD SHA mismatch`; the pre-existing PR-mismatch test is
  unchanged and still passes. The widening changes which namespaces are *legal*, nothing about what
  an executor result must *attest to*.
- [x] **A5 — An unrecognized namespace is still refused.** `feature/utv2-1619-…`, with the head ref
  set to match so the mismatch rule cannot be what rejects it, still produces `Invalid branch`.
- [x] **A6 — `Lane:` semantics are unchanged.** The `['claude','codex']` check is untouched; the
  bootstrap fixture declares `Lane: claude`, consistent with `Lane:` naming the executor rather than
  the branch namespace.
- [x] **A7 — The duplication is now self-policing, and that assertion was mutation-tested in the
  direction that matters.** Reverting **only** the workflow copy — leaving the script correct — is
  caught by `UTV2-1688: the workflow branch literal is byte-identical to the exported one`. Before
  this lane, that revert was invisible to every test in the repository, which is exactly how the
  `bootstrap/` gap survived in it.
- [x] **A8 — Regression.** `scripts/ops/executor-result-validate.test.ts` reports 27 tests, 0
  failures. `pnpm type-check` exits 0. Full-suite result under EVIDENCE.
- [x] **A9 — A required-check workflow was changed, deliberately and narrowly, and this is stated
  rather than buried.** `.github/workflows/executor-result-validator.yml` is the workflow behind a
  required context. What changed inside it is one regex alternation and comments. **No change** was
  made to required-check *configuration*, branch protection, CODEOWNERS, the merge gate, tier
  semantics, approval policy, or any bypass — `git diff origin/main --name-only -- .github/` lists
  that one file. This is the scope UTV2-1688's own PM-authored acceptance criteria define ("No
  change to required-check configuration, branch protection, or any bypass"), and the change only
  ever *admits an additional namespace*; it removes no requirement.
- [x] **A10 — The `work/` namespace and `WORK-###` issue IDs are deliberately NOT included.** The
  tracker-independence cutover wants them, and they are one word each in the same two literals.
  Admitting a repo-minted identity into a required check changes what that check requires, which is
  reserved (`intent.md` reserved decision 7, and cutover items 8–11). It is prepared as a reviewable
  diff, not applied. This lane therefore does **not** close cutover exit condition 1.
- [x] **A11 — `docs/mission/plan.md` is corrected, not merely extended.** It recorded
  `scripts/ops/executor-result-validate.ts` as the hunk "without which no branch reaches a green
  `Executor Result Validation`". A2 measures that as false. The correction is written as a
  correction, and names the already-filed issue that had it right in August.

EVIDENCE:

r-level-check: `scripts/ci/r-level-check.ts` was run locally at this anchor. Output:

```text
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

This diff touches one workflow's inline validation logic, one ops script, its test file and docs, so
no R-level artifact beyond the diff summary and this verification log is required, and none is
claimed.

**A1 — defect reproduction, before and after, by execution.** Same fixture, same context, only the
module under test differs:

```text
### BEFORE (origin/main copy of the script)
Invalid branch: "bootstrap/utv2-1619-repository-truth-integrity". Must match claude/utv2-NNN-*,
codex/utv2-NNN-*, claude/uni-NNN-*, or codex/uni-NNN-*.

### AFTER (this lane's script)
ZERO ERRORS — bootstrap/ accepted
```

**A2 — the copy that actually gates merges, measured on its own.** The inline literal was extracted
from each version of the workflow and evaluated:

```text
BEFORE (origin/main)  literal=/^(claude|codex)\/(utv2|uni)-\d+/i
             branchRe.test("bootstrap/utv2-1619-repository-truth-integrity") = false
AFTER  (this lane)  literal=/^(claude|codex|bootstrap)\/(utv2|uni)-\d+/i
             branchRe.test("bootstrap/utv2-1619-repository-truth-integrity") = true
```

**Mutation controls — three, each killing a different assertion.** Suite is
`scripts/ops/executor-result-validate.test.ts`; every mutation was reverted byte-for-byte after:

```text
### M1  script-only revert (bootstrap dropped from the exported constant)
not ok 22 - UTV2-1688: a bootstrap/ branch validates with zero errors
not ok 27 - UTV2-1688: the workflow branch literal is byte-identical to the exported one
# tests 27 / # pass 25 / # fail 2

### M2  workflow-only revert (bootstrap dropped from the copy that gates merges)
not ok 27 - UTV2-1688: the workflow branch literal is byte-identical to the exported one
# tests 27 / # pass 26 / # fail 1

### M3  delete the `Branch: == head ref` binding
not ok 23 - UTV2-1688 control: a bootstrap/ branch that disagrees with the PR head is still rejected
# tests 27 / # pass 26 / # fail 1

### restored
# tests 27 / # pass 27 / # fail 0
```

M2 is the load-bearing one. It is the exact shape of the defect this issue describes — the script
correct, the gate stale — and before this lane nothing in the repository failed on it.

**A2 — consumer sweep, verbatim.**

```text
$ grep -rn "validateExecutorResultFields" . | grep -v node_modules | grep -v "\.git/"
scripts/ops/executor-result-validate.ts:53:  (doc comment)
scripts/ops/executor-result-validate.ts:106: export function validateExecutorResultFields(...)
scripts/ops/executor-result-validate.test.ts: (14 call sites)

$ grep -rn "executor-result-validate" .github/workflows/
executor-result-validator.yml:27,28,76  — comments
executor-result-validator.yml:103       — resolve-check-name only
```

**`pnpm verify` — not run to a PASS locally, and no local PASS is claimed.** `pnpm verify` reaches
`test:live-db` → `test:db` → `ci:assert-staging`, which refuses on any developer machine:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
```

The required `verify` check on this PR, which runs inside the staging-ci environment, is the
authoritative result. Locally, `pnpm type-check` exits 0 and `pnpm test` reports:

```text
$ pnpm test          # exit 0
100 suite blocks
# tests 5962
# fail  0
`not ok` lines: 0

$ pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts
# tests 27 / # pass 27 / # fail 0
```

**A9 — reserved-surface accounting.**

```text
$ git diff origin/main --name-only -- .github/
.github/workflows/executor-result-validator.yml
```

One file, one regex alternation, plus comments. No workflow was added or removed, no required-check
configuration changed, no branch protection or CODEOWNERS change, no merge-gate or tier change.

## Commands run

```bash
pnpm type-check
pnpm test
pnpm verify
pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts
pnpm exec tsx scripts/ci/r-level-check.ts
grep -rn "validateExecutorResultFields" . | grep -v node_modules
git diff origin/main --name-only -- .github/
```
