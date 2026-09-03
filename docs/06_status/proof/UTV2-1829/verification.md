# PROOF: UTV2-1829

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-03T05:30:00.000Z
Issue: UTV2-1829
Tier: T2
Lane type: governance
Branch: claude/utv2-1829-mission-context
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1499
Head SHA: bfa1cedd631e98913f8ce4dc39c5e424e09cfd5d
result: pass

## ASSERTIONS:

- [x] **A1 — The diff carries nothing outside the declared file scope plus the one
      externally-authorized path.** Every changed path is `CLAUDE.md`, `AGENTS.md`,
      `docs/mission/**`, this lane's own control-plane files, or `.lane/lanes/governance.yml`
      — the single file admitted by the CODEOWNERS `scope-override/v1` comment on PR #1499
      (A8). Measured: 0 files outside that set. Falsifies if any workflow, hook, script,
      settings, or source file appears.
- [x] **A2 — Nothing from #1491 / #1492 rides along.** No `.github/**`, `.claude/**`,
      `.agents/**`, `scripts/**`, `eslint.config.mjs`, or `package.json` change. Measured
      count: 0. This is the assertion that separates the mission layer from the frozen
      governance work; a single such file would falsify it. No RMA, no merge-authority
      change, no dispatch or lane replacement, and no tier redefinition is present in any
      added line.
- [x] **A3 — `AGENTS.md` is a pure insertion; `CLAUDE.md` is an insertion plus one
      deliberate replacement.** Measured `+18/-0` on `AGENTS.md` and `+24/-4` on `CLAUDE.md`.
      The four deleted `CLAUDE.md` lines are the stale volatile "Build status — Phase 7A"
      block, replaced at PM direction by a pointer to `docs/mission/plan.md` so the root
      instruction file stays stable and pointer-based. No other existing instruction was
      altered or removed. An earlier revision of this bundle asserted both files were pure
      insertions; that is no longer true, and this assertion states the measured truth rather
      than restating the old claim.
- [x] **A4 — Every repo path `spec.md` points at exists on `main`.** 47 referenced paths
      checked, 0 missing. Falsifies on the first dangling pointer — this is what stops the
      index from citing a contract that lives only on a frozen branch.
- [x] **A5 — `spec.md` introduces no competing readiness threshold.** No numeric
      threshold, percentage, or comparison appears anywhere in the file.
      `T1_PRODUCTION_READINESS_CONTRACT.md` remains the sole definition.
- [x] **A6 — No R-level artifacts are required for this diff.** `r-level-check` verdict
      PASS over 11 changed files, rules matched: none.
- [x] **A7 — `main` was not modified.** The change reached `main` only as PR #1499 from
      the lane branch; the control checkout carries no commit.
- [x] **A8 — The governance lane's path contract now admits `docs/mission/**`, through the
      authorized bounded expansion and nothing wider.** `.lane/lanes/governance.yml`
      enumerates every docs subtree a governance lane may touch, and `docs/mission/**` was in
      none of them — so `lane:check` failed on `intent.md`, `spec.md` and `plan.md` while
      `CLAUDE.md` and `AGENTS.md` were already individually admitted: a governance lane could
      add the pointer but never the target. This PR adds exactly one glob, `docs/mission/**`.
      Measured: `lane:check PASS lane=governance files=11`, and the diff touches exactly one
      `.lane/**` file. That file is outside this lane's pinned `file_scope_lock`, so it is
      admitted *only* by an externally authored `scope-override/v1` comment from a CODEOWNERS
      human; measured directly, `file-scope-guard` FAILS on `.lane/lanes/governance.yml`
      without the override and PASSES with it. Falsifies if any second `.lane/**` file
      appears, or if any glob other than `docs/mission/**` is added.
- [x] **A9 — No personal address and no secret value is committed.** `docs/mission/plan.md`
      previously carried a real sign-in address and a real `ALLOWED_CAPPER_EMAILS` mapping;
      both are removed. The file now names the secret and its required
      `<email>=<canonicalCapperId>` shape only, and states that the value lives solely in the
      sanctioned secret store. Measured: 0 email addresses in the added lines of the whole
      diff.

## EVIDENCE:

```
$ git rev-parse HEAD
bfa1cedd631e98913f8ce4dc39c5e424e09cfd5d

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff

$ git diff --name-only origin/main..HEAD
.lane/lanes/governance.yml
.ops/sync/UTV2-1829.yml
AGENTS.md
CLAUDE.md
docs/06_status/lanes/UTV2-1829.json
docs/06_status/proof/UTV2-1829/diff-summary.md
docs/06_status/proof/UTV2-1829/evidence.json
docs/06_status/proof/UTV2-1829/verification.md
docs/mission/intent.md
docs/mission/plan.md
docs/mission/spec.md

$ git diff --name-only origin/main..HEAD | grep -vE '^(CLAUDE\.md|AGENTS\.md|docs/mission/|\.lane/lanes/governance\.yml$|\.ops/sync/UTV2-1829\.yml$|docs/06_status/lanes/UTV2-1829\.json$|docs/06_status/proof/UTV2-1829/)'
(no output — 0 files outside scope)

$ git diff --name-only origin/main..HEAD | grep -cE '^(\.github/|\.claude/|\.agents/|scripts/|eslint\.config|package\.json)'
0

$ git diff --numstat origin/main..HEAD -- CLAUDE.md AGENTS.md
18	0	AGENTS.md
24	4	CLAUDE.md

$ git diff --name-only origin/main..HEAD -- '.lane/**'
.lane/lanes/governance.yml

$ git diff -U0 origin/main..HEAD | grep '^+' | grep -iE '@[a-z0-9.-]+\.(com|net|org)' | grep -v noreply@anthropic
(no output — no personal address or secret value added)

$ for p in $(grep -oE '`(docs/...|packages/db/src/database\.types\.ts|\.github/workflows/merge-gate\.yml)`' docs/mission/spec.md | tr -d '`' | sort -u); do [ -f "$p" ] || echo "MISSING: $p"; done
spec.md referenced repo paths: 47 checked, 0 missing

$ grep -nE '[0-9]+(\.[0-9]+)?\s*%|>=\s*[0-9]|threshold of [0-9]' docs/mission/spec.md
(none)

$ pnpm exec tsx scripts/lane-check.ts --lane governance --base origin/main --head HEAD
lane:check PASS lane=governance files=11

$ npx tsx scripts/ci/file-scope-guard.ts --branch claude/utv2-1829-mission-context \
    --changed-files-file <diff> --manifest-source git          # no override
FILE SCOPE LOCK CHECK FAILED

Files outside this lane scope:
- .lane/lanes/governance.yml is not declared by UTV2-1829 (claude/utv2-1829-mission-context)

$ npx tsx scripts/ci/file-scope-guard.ts --branch claude/utv2-1829-mission-context \
    --changed-files-file <diff> --manifest-source git \
    --override-file <CODEOWNERS scope-override/v1 record> \
    --pr-number 1499 --head-sha bfa1cedd631e98913f8ce4dc39c5e424e09cfd5d
No file scope lock conflicts or scope violations detected.

$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm build
exit 0

$ pnpm test
exit 0
AGGREGATE tests=5459 pass=5459 fail=0

$ pnpm verify
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
  GitHub environment with CI_SUPABASE_* credentials.
```

## Verification
- [x] `pnpm type-check`: PASS (exit 0)
- [x] `pnpm lint`: PASS (exit 0)
- [x] `pnpm build`: PASS (exit 0)
- [x] `pnpm test`: PASS (exit 0) — 5459 tests, 5459 pass, 0 fail
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no rules matched
- [ ] `pnpm verify`: **not obtainable locally.** The chain reaches `test:live-db` and
      `ci:assert-staging` refuses a non-staging target under local containment, by design.
      Every stage before it (`env:check`, `lint`, `type-check`, `build`, `test`,
      `verify:commands`) passed. CI runs `verify` in the `staging-ci` environment; the
      required `verify` check on PR #1499 is the authoritative receipt.

## Runtime Verification

Not applicable and not claimed. This lane changes documentation, two agent instruction files,
and one lane path-contract entry. It adds no code path, no schema, no workflow, and no runtime
behavior — see assertions A1 and A2, which measure exactly that. No runtime proof is asserted,
and none should be accepted as satisfied for this bundle.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1499
Approved PR head: pending merge
Execution SHA: bfa1cedd631e98913f8ce4dc39c5e424e09cfd5d
