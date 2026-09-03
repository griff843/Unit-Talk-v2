# PROOF: UTV2-1829

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-03T04:38:46.476Z
Issue: UTV2-1829
Tier: T2
Lane type: governance
Branch: claude/utv2-1829-mission-context
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1499
Head SHA: b7f0179e4ad3d20dcfc6872caca2ebb780b36806
result: pass

## ASSERTIONS:

- [x] **A1 — The diff carries nothing outside the declared file scope.** Every changed
      path is `CLAUDE.md`, `AGENTS.md`, `docs/mission/**`, or this lane's own control-plane
      files. Measured: 0 files outside. Falsifies if any workflow, hook, script, settings,
      or source file appears.
- [x] **A2 — Nothing from #1491 / #1492 rides along.** No `.github/**`, `.claude/**`,
      `.agents/**`, `scripts/**`, `eslint.config.mjs`, or `package.json` change. Measured
      count: 0. This is the assertion that separates the mission layer from the frozen
      governance work; a single such file would falsify it.
- [x] **A3 — `CLAUDE.md` and `AGENTS.md` are pure insertions.** Deletion count is 0 on
      both (`+21/-0` and `+18/-0`). No existing instruction was altered or removed.
- [x] **A4 — Every repo path `spec.md` points at exists on `main`.** 47 referenced paths
      checked, 0 missing. Falsifies on the first dangling pointer — this is what stops the
      index from citing a contract that lives only on a frozen branch.
- [x] **A5 — `spec.md` introduces no competing readiness threshold.** No numeric
      threshold, percentage, or comparison appears anywhere in the file.
      `T1_PRODUCTION_READINESS_CONTRACT.md` remains the sole definition.
- [x] **A6 — No R-level artifacts are required for this diff.** `r-level-check` verdict
      PASS, rules matched: none.
- [x] **A7 — `main` was not modified.** The change reached `main` only as PR #1499 from
      the lane branch; the control checkout carries no commit.

## EVIDENCE:

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff

$ git diff --name-only origin/main..HEAD | grep -vE '^(CLAUDE\.md|AGENTS\.md|docs/mission/|\.ops/sync/UTV2-1829\.yml$|docs/06_status/lanes/UTV2-1829\.json$|docs/06_status/proof/UTV2-1829/)'
(no output — 0 files outside scope)

$ git diff --name-only origin/main..HEAD | grep -cE '^(\.github/|\.claude/|\.agents/|scripts/|eslint\.config|package\.json)'
0

$ git diff --numstat origin/main..HEAD -- CLAUDE.md AGENTS.md
21  0   CLAUDE.md
18  0   AGENTS.md

$ for p in $(grep -oE '`(docs/...|packages/db/src/database\.types\.ts|\.github/workflows/merge-gate\.yml)`' docs/mission/spec.md | tr -d '`' | sort -u); do [ -f "$p" ] || echo "MISSING: $p"; done
spec.md referenced repo paths: 47 checked, 0 missing

$ grep -nE '[0-9]+(\.[0-9]+)?\s*%|>=\s*[0-9]|threshold of [0-9]' docs/mission/spec.md
(none)

$ pnpm ops:preflight UTV2-1829 --branch claude/utv2-1829-mission-context --tier T2 --refresh --files CLAUDE.md --files AGENTS.md --files 'docs/mission/**'
VERDICT: PASS (38 checks)
  PX1 PASS  pnpm verify:quick passed
  PB1 PASS  pnpm type-check passed
  PB2 PASS  pnpm test passed after full-verify slot 1/1

$ pnpm type-check
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm test
(exit 0)

$ pnpm verify
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
  GitHub environment with CI_SUPABASE_* credentials.
```

## Verification
- [x] `pnpm type-check`: PASS (exit 0)
- [x] `pnpm lint`: PASS (exit 0)
- [x] `pnpm test`: PASS (exit 0); independently confirmed by preflight PB2
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no rules matched
- [ ] `pnpm verify`: **not obtainable locally.** The chain reaches `test:live-db` and
      `ci:assert-staging` refuses a non-staging target under local containment, by design.
      Every stage before it (`env:check`, `lint`, `type-check`, `build`, `test`,
      `verify:commands`) passed. CI runs `verify` in the `staging-ci` environment; the
      required `verify` check on PR #1499 is the authoritative receipt.

## Runtime Verification

Not applicable and not claimed. This lane changes documentation and two agent instruction
files only. It adds no code path, no schema, no workflow, and no runtime behavior — see
assertions A1 and A2, which measure exactly that. No runtime proof is asserted, and none
should be accepted as satisfied for this bundle.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1499
Approved PR head: pending merge
Execution SHA: b7f0179e4ad3d20dcfc6872caca2ebb780b36806
