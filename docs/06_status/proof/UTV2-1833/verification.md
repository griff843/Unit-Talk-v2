# PROOF: UTV2-1833

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-05T15:30:29.000Z
Issue: UTV2-1833
Tier: T3
Lane type: governance
Branch: claude/utv2-1833-mission-direction
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1506
Head SHA: 1256c3a7d20ace4453a89fe93a5c47eef892284a
result: pass

## Summary

This lane records a PM-ratified mission direction in `docs/mission/intent.md` and reconciles
`docs/mission/plan.md` against live GitHub, runtime and secret-metadata truth. It changes two
mission documents and this lane's own manifest, sync and proof artifacts. It changes **no**
gate, no tier, no merge authority, no workflow, no application code and no schema.

Because the diff is documentation plus this lane's own control-plane artifacts, the R-level
rule set matches no rule and requires no additional evidence artifact. The evidence below is
therefore the repository-wide static suite, executed on this branch.

## ASSERTIONS:

- [x] `docs/mission/intent.md` records only direction Griff ratified in-session, and records
      it as ratified — no agent-authored intent is introduced.
- [x] The edit changes no gate, tier, merge authority, workflow, hook or application code.
      `git diff --name-only` against the merge base lists mission docs and this lane's own
      manifest/sync/proof artifacts, and nothing else.
- [x] `pnpm type-check` passes on the branch (exit 0).
- [x] `pnpm test` passes on the branch: 5476 tests, 5476 pass, 0 fail (exit 0).
- [x] `scripts/ci/r-level-check.ts` returns PASS with no rules matched, so no R-level
      artifact is required for this diff.
- [x] The prior `plan.md` claim that `matchesAny()` omits micromatch's `dot` option is
      corrected in this lane: `scripts/lane-contract.ts:214` does pass `{ dot: true }`.
      The correction replaces the wrong diagnosis rather than appending to it.
- [x] The `ALLOWED_CAPPER_EMAILS` reshape is recorded by update *timestamp* only. No agent
      read, printed or recorded the secret value, and the value appears nowhere in this diff.

## EVIDENCE:

```
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics)
TYPECHECK_EXIT=0

$ pnpm test
# tests 5476
# pass 5476
# fail 0
# cancelled 0
# skipped 0
# todo 0
TEST_EXIT=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0

$ git diff --name-only 058aab04b360e1f69ec11bc66287a6768dc1ed4e..HEAD
.ops/sync/UTV2-1833.yml
docs/06_status/lanes/UTV2-1833.json
docs/06_status/proof/UTV2-1833/.gitkeep
docs/mission/intent.md
docs/mission/plan.md
```

`pnpm verify` is not re-run locally here: the required `verify` context executed it in CI on
this branch and reported `pass` (run 33974463254). Re-stating a CI result as a local run
would be a claim the local artifact does not support.

## Verification
- [x] `pnpm type-check`: PASS (exit 0)
- [x] `pnpm test`: PASS — 5476/5476, 0 fail (exit 0)
- [x] `pnpm verify`: PASS in the required CI `verify` context on this branch (run 33974463254)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no rules matched

## Runtime Verification

No runtime proof is applicable or claimed. This lane changes two Markdown documents under
`docs/mission/` and its own lane artifacts; it ships no code path, no query and no
configuration into any running container. Asserting a runtime observation here would be a
claim about behaviour this diff does not touch.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1506
Approved PR head: pending merge
Execution SHA: 1256c3a7d20ace4453a89fe93a5c47eef892284a
