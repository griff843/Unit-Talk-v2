# PROOF: UTV2-1829

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-03T16:40:00.000Z
Issue: UTV2-1829
Tier: T2
Lane type: governance
Branch: claude/utv2-1829-mission-context
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1499
Head SHA: 5b895abdb96c881030e2c2979bde100e1c151e37
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

- [x] **A10 — The branch was resynced to `main` through the sanctioned wrapper, and the
      history was then collapsed onto that sync without changing one byte of content.**
      `main` advanced past this lane twice: once when #1485 merged and its three lane-closes
      landed, and again on two `ops(readiness): refresh ledger [skip ci]` commits that write
      to `main` on a schedule with no PR. The branch was brought forward with
      `pnpm ops:merge-wrapper git-merge-main --issue UTV2-1829` — never a raw `git merge` —
      which reported the head move and named every head-pinned artifact it invalidated.
      The lane's five work-in-progress commits were then collapsed into one implementation
      commit plus this proof commit, because the *bodies* of two of them cited other issue
      IDs and that is the sole reason `Check issue references` was red. Measured, and this is
      the assertion that makes the collapse safe: `git diff --stat ea1c1558d HEAD` over every
      non-proof path reports exactly one file, `docs/mission/plan.md`, at +27/-10 — which is
      this reconciliation and nothing else. Every other path in the lane is byte-identical to
      the pre-collapse head, so the collapse dropped nothing and added nothing. The
      pre-collapse head `ea1c1558d` is pushed as `origin/backup/utv2-1829-pre-collapse`
      specifically so a reviewer can run that diff, rather than having to take this bundle's
      word for it. Falsifies if that diff names any second path, if
      the `plan.md` delta exceeds the reconciliation A11 bounds, or if any commit body on the
      branch still names an issue other than UTV2-1829.

- [x] **A11 — The live-state sections of `plan.md` name only measured current truth.** The
      reconciliation replaced three stale claims: that two lanes still sat `in_review` and
      needed a closeout replay (both now read `done` on `origin/main`, at `43a1bf0f4` and
      `b729447d2`), that production was "23 commits behind" (unmeasurable and now stated as
      the actual last promote, `e48106fc` at 2026-09-01T13:28Z), and that the
      `scope-override/v1` artifact was simply "missing" (it had been posted twice — the
      record is pinned to an exact head SHA, so each head move invalidates it). It also
      records what the one closeout replay actually failed on: `L3 — Linear state Backlog is
      not an active or closeout state`, not the rebinder. No mission intent, architecture,
      scope, execution authority, readiness threshold or approved content was changed — the
      diff touches only the reconciled-truth header, the resolved-defect section, two
      Requires-Griff items, and the reconciliation timestamp. Falsifies if the `plan.md` diff
      touches any section other than those.

      A11 covers two `plan.md` commits, measured separately. **(a) The reconciliation**
      (`ea1c1558d` → `938c45fb5`): +27/-10 across five hunks — the reconciled-truth header, the
      resolved-defect section, Requires-Griff items 2 and 9, and the timestamp. **(b) The policy
      instances** (`938c45fb5` → HEAD): three hunks — the admissibility-debt section gains the two
      canonical issue owners and the PM ruling that the gate is not changed; Wave 6 gains the
      empty-slot rule; Learned gains four entries. **(c) The PM-directed corrections**
      (`938c45fb5` → `5b895abdb`): exactly two files, `docs/mission/plan.md` and
      `docs/mission/spec.md`. All three commits touch live state, recorded observation and index
      pointers only. `intent.md` is covered separately by A12.

      An earlier revision of this assertion said `spec.md` was byte-identical across the whole
      lane. That was true when written and stopped being true at `5b895abdb`, which corrects the
      program-status pointer and the incident-runbook binding status. It is restated here rather
      than left standing. Falsifies if any of the three diffs reaches a section outside those
      named.

- [x] **A13 — the four PM-identified overstatements are corrected, and each correction is backed by
      the source that contradicted the earlier claim.** Every measurement below is read from
      `origin/main`, not from this branch, so a reviewer can check the corrections against a source
      this PR does not control.

      **(1) Deploy smoke vs. current readiness.** `plan.md` previously headed the section
      "Production is deployed, healthy, and contained". `origin/main`'s
      `docs/06_status/readiness/readiness-score.json`, generated `2026-09-03T15:40:56.081Z`, reports
      `verdict: RED`, `observability: degraded`, `deployed_sha e48106fc…` against
      `main_sha 48b5f679…` — the deployed commit is not `main`. The section now separates the
      point-in-time 2026-09-01 smoke from current readiness and states the RED verdict up front.

      **(2) Direct-`main` prevention sequencing.** The sentence "it should follow the backlog, not
      precede it" now occurs 0 times. The prohibition is already in force; what is outstanding is a
      *mechanical* prevention control, which is a reserved PM decision. Incorrectly created PRs do
      not earn a deferral of a safety control. Branch protection is not changed in this lane (A14).

      **(3) Program-status entrypoint.** `origin/main`'s `PROGRAM_STATUS.md` line 3 reads
      "SUPERSEDED / HISTORICAL — This document is retained for audit history only" and names
      `docs/06_status/CURRENT_STATE.md`. `spec.md` now points at `CURRENT_STATE.md`, lists
      `PROGRAM_STATUS.md` only so an agent who finds it knows what it is, and states that live
      evidence overrides every status snapshot including `CURRENT_STATE.md`.

      **(4) Incident runbooks.** `INCIDENT_RUNBOOK.md` declares `Status: DRAFT — PM ratification
      required before treated as binding process`; `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md`
      declares `Status: DRAFT`. Listing them unqualified in a safety-boundary table promoted them by
      placement to an authority their own text refuses. They are now marked non-binding, and the
      ratified authorities that actually govern incident action are named:
      `DB_ENVIRONMENT_OPERATOR_POLICY.md` (RATIFIED), `BREAK_GLASS_PROTOCOL.md` (Active),
      `STANDING_GUARDRAILS.md`, and the reserved decisions in `intent.md`.

      Falsifies if any of the four quoted source strings differs on `origin/main`, or if the
      deferral sentence reappears.

- [x] **A14 — the corrections change no gate, contract, workflow or branch protection.** The
      correction commit `5b895abdb` names exactly two files, `docs/mission/plan.md` and
      `docs/mission/spec.md`. Across the whole branch diff,
      `git diff --name-only origin/main..HEAD | grep -cE '^(\.github/|\.claude/|scripts/|package\.json|docs/05_operations/)'`
      returns **0**. This matters specifically because correction (2) is *about* a branch-protection
      decision: the lane records the correct sequencing and leaves the reserved decision to PM
      rather than acting on it. Falsifies if that count is non-zero.

- [x] **A12 — `intent.md` carries exactly one addition, and it is a PM ratification recorded rather
      than an agent decision.** The only change to the owner-authored file is the section
      "Governance and tooling debt policy", ratified 2026-09-03: a filing threshold, a
      one-defect-class-one-issue rule, an explicit statement that the single governance slot may
      stand empty, and the rule that the existing backlog is dispositioned by a classified pass and
      never mass-closed. Measured: `git diff --stat <prior anchor> HEAD -- docs/mission/intent.md`
      is +27/-0 — a pure insertion, no line of existing owner intent modified or removed. It
      creates no contract file, no doc family and no process, and touches no gate, tier, lane
      contract or merge-authority path: `git diff --name-only origin/main..HEAD` still reports 0
      files under `.github/`, `.claude/`, `scripts/` or `package.json` (A2). Falsifies if the
      `intent.md` deletion column is non-zero, or if any new file appears under
      `docs/05_operations/`.

## EVIDENCE:

```
$ git rev-parse HEAD
5b895abdb96c881030e2c2979bde100e1c151e37

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
    --pr-number 1499 --head-sha <PR head at the time of evaluation>
No file scope lock conflicts or scope violations detected.

(The override record is pinned to the PR head, not to the implementation anchor above.
A new commit invalidates it and a fresh override is required — that is the control working,
not a defect. The head this bundle was authored against is recorded in the EXECUTOR_RESULT
comment on PR #1499.)

$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm build
exit 0

$ pnpm test
exit 0
AGGREGATE tests=5463 pass=5463 fail=0

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
- [x] `pnpm test`: PASS (exit 0) — 5463 tests, 5463 pass, 0 fail
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
Execution SHA: 5b895abdb96c881030e2c2979bde100e1c151e37
