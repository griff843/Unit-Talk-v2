# PROOF: UTV2-1830

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-05T02:48:42.000Z
Issue: UTV2-1830
Tier: T3
Lane type: governance
Branch: claude/utv2-1830-mission-stop-conditions
PR URL: pending
Head SHA: 1485f4bc2083dd1c523d377ccee1ae7b6e981456
result: pass

## ASSERTIONS:

- [x] **A1 — The diff carries nothing outside the declared file scope.** Every changed path is
      `CLAUDE.md`, `docs/mission/**`, or this lane's own control-plane files
      (`.ops/sync/UTV2-1830.yml`, `docs/06_status/lanes/UTV2-1830.json`,
      `docs/06_status/proof/UTV2-1830/`). Measured: 0 files outside that set. Falsifies if any
      workflow, hook, script, settings, source, or lane-contract file appears.
- [x] **A2 — No executable or governance-mechanical surface is touched.** No `.github/**`,
      `.claude/**`, `.agents/**`, `scripts/**`, `.lane/**`, `apps/**`, `packages/**`,
      `eslint.config.mjs` or `package.json` change. Measured count: 0. This is the assertion that
      backs the PM's explicit constraint on this lane — *"Do not create a new contract, governance
      program, or issue family for it"* — mechanically rather than by narration: no gate, tier,
      lane contract or merge-authority path can have changed if none of those files is in the diff.
      Unlike UTV2-1829, this lane also required **no** `scope-override/v1` record, because
      `docs/mission/**` was admitted to `.lane/lanes/governance.yml` by #1499 and is now on `main`.
- [x] **A3 — `CLAUDE.md` is a pure insertion and a pointer, not a rule.** Measured `+4/-0`: one
      bullet appended under "Session discipline". It states the rule in one clause and then names
      `docs/mission/intent.md` § "Stop conditions" as authoritative. No existing instruction is
      modified or removed, and no procedural detail is added to the root file — which is what
      `CLAUDE.md` § "What this file is not" requires. Falsifies on any non-zero deletion column.
- [x] **A4 — `intent.md` changed in exactly one place, the "Stop conditions" section.** Measured
      `+27/-2` in a **single hunk** at `@@ -181,10 +181,35 @@`. No other section of the owner's
      intent document is touched. The two deleted lines are the terse prior stop-condition
      statement that the ratified text replaces; nothing else is removed.
- [x] **A5 — The recorded text reproduces the ratified correction clause for clause, and adds no
      authority the PM did not grant.** All four "not a stop condition" items the PM enumerated are
      present as bullets (waiting on CI/review/a PR; finishing a lane or PR; having something to
      report; a question, correction or steering from Griff), plus the "a reserved gate blocks only
      the work that depends on it" rule and the "do not return control merely because you have
      something to report" clause. The section also carries a limit the PM's message implies but
      did not state, and it narrows rather than widens: *"continuing without stopping is not
      permission to change how the system works. Continuous execution runs inside the existing
      lane, tier, proof and merge-authority contracts, never around them."*
- [x] **A6 — Every factual claim added to `plan.md` is read from a source outside this branch.**
      `main` tip, open-PR set and per-PR check conclusions from the GitHub API; readiness verdict,
      `deployed_sha` and `main_sha` from `docs/06_status/readiness/readiness-score.json` on `main`;
      the `ALLOWED_CAPPER_EMAILS` update timestamp from `gh secret list` metadata; merge SHAs and
      merge times from `gh pr view`; the last `Deploy` run from `gh run list`. The commands and
      their outputs are in EVIDENCE below. Falsifies if any claim is traceable only to this bundle.
- [x] **A7 — No secret value is recorded, and none was read.** The plan records *that*
      `ALLOWED_CAPPER_EMAILS` was reshaped and *when* (2026-09-03T17:29:12Z), from the secret
      listing's metadata, which returns names and timestamps only. The value was never retrieved,
      printed, or written to any file. Measured: 0 additions in the whole diff matching an email or
      address shape. This is a standing mission constraint, not a lane-local nicety.
- [x] **A8 — No R-level artifact is required for this diff.** `r-level-check` verdict PASS, 6
      changed files, no rules matched.
- [x] **A9 — The branch is not behind `main` and the anchor is the last non-proof commit.** The
      lane was resynced through the sanctioned wrapper *before* the bundle was authored, so no
      head-pinned artifact is invalidated after the fact. `git-rebase-main` was chosen over
      `git-merge-main` deliberately and the reasoning is stated rather than assumed: the standing
      preference for `git-merge-main` protects branches carrying head-pinned governance artifacts,
      and at the moment of the sync this branch carried **none** — no PR, no proof bundle, no
      `EXECUTOR_RESULT`, no verdict. The wrapper still printed its full invalidation warning, which
      is correct behaviour and not evidence that anything was invalidated.

## EVIDENCE:

```
$ git rev-parse HEAD
1485f4bc2083dd1c523d377ccee1ae7b6e981456

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff

$ git diff --name-only origin/main..HEAD
.ops/sync/UTV2-1830.yml
CLAUDE.md
docs/06_status/lanes/UTV2-1830.json
docs/06_status/proof/UTV2-1830/.gitkeep
docs/mission/intent.md
docs/mission/plan.md

$ git diff --name-only origin/main..HEAD | grep -vE '^(CLAUDE\.md|docs/mission/|\.ops/sync/UTV2-1830\.yml$|docs/06_status/lanes/UTV2-1830\.json$|docs/06_status/proof/UTV2-1830/)'
(no output — 0 files outside scope)

$ git diff --name-only origin/main..HEAD | grep -cE '^(\.github/|\.claude/|\.agents/|scripts/|\.lane/|apps/|packages/|eslint\.config|package\.json)'
0

$ git diff --numstat origin/main..HEAD -- CLAUDE.md docs/mission/intent.md docs/mission/plan.md
4	0	CLAUDE.md
27	2	docs/mission/intent.md
152	94	docs/mission/plan.md

$ git diff origin/main..HEAD -- docs/mission/intent.md | grep -E '^@@'
@@ -181,10 +181,35 @@ Not done because: a PR merged, a ticket closed, CI turned green, ...
(exactly one hunk)

$ sed -n '/^These are explicitly \*\*not\*\* stop conditions:/,/^Between stop conditions/p' docs/mission/intent.md | grep -c '^- \*\*'
4

$ git diff -U0 origin/main..HEAD | grep '^+' | grep -iE '@[a-z0-9.-]+\.(com|net|org)' | grep -v noreply@anthropic
(no output — no personal address or secret value added)

$ pnpm exec tsx scripts/lane-check.ts --lane governance --base origin/main --head HEAD
lane:check PASS lane=governance files=6

--- sources the plan.md reconciliation was read from (none of them this branch) ---

$ git log origin/main -3 --format='%h %s'
85f63c696 ops(readiness): refresh ledger [skip ci]
9797bcbee chore(lanes): close UTV2-1811 — lane closed, sync file removed
1734bf201 Merge pull request #1477 from griff843/claude/utv2-1811-rate-limit-bucket-contract

$ gh pr list --state open --limit 30 --json number --jq 'length'
11
(#1429, #1451, #1479, #1484, #1491, #1492, #1493, #1494, #1495, #1496, #1498)

$ for n in 1498 1496 1495 1494 1493 1492 1491 1484 1479 1451 1429; do gh pr view $n --json statusCheckRollup ...; done
verify SUCCESS: 1498 1496 1495 1494 1493 1492 1491 1484        (8)
verify FAILURE: 1479 1451 1429                                  (3)
Merge Gate FAILURE: all 11

$ for n in 1477 1485 1488 1497 1499 1501; do gh pr view $n --json state,mergedAt,mergeCommit; done
1477 MERGED 2026-09-05T01:43:16Z 1734bf2017eb0fe5e00d93a4cff3d074d7be4546
1485 MERGED 2026-09-03T05:42:36Z 5ed005a6da848917a355c4c0ee5e7d8f5513713b
1488 MERGED 2026-09-03T04:52:13Z 2ac23342444ee2b3fbb086493e1b6ca6d862c59f
1497 CLOSED  (not merged)
1499 MERGED 2026-09-04T03:54:58Z d70df07787002db02e007df9ae8b347c40bbb1a9
1501 MERGED 2026-09-03T19:26:57Z b7d9fc07fca5a03d5cf0b343beb3161c58295aed

$ git show origin/main:docs/06_status/readiness/readiness-score.json | jq -r '.generated_at, .verdict, .observability, .deployed_sha, .main_sha'
2026-09-05T02:37:43.611Z
RED
degraded
e48106fc9a5eb5904b322833d0968da5ae0b0665
9797bcbee4a3255bdb64911fac5a9407cc5df826

$ gh secret list --repo griff843/Unit-Talk-v2 | grep -i capper
ALLOWED_CAPPER_EMAILS	2026-09-03T17:29:12Z
(name and update timestamp only — the listing returns no value, and none was requested)

$ gh run list --workflow=deploy.yml --limit 3
33513608611 success 2026-09-01T13:28:39Z e48106fc
33509070551 success 2026-09-01T12:41:32Z e48106fc
33508573234 failure 2026-09-01T12:36:01Z f69d86f9
(no Deploy run since 2026-09-01)

$ grep -l '"status": *"in_progress"' docs/06_status/lanes/*.json
(no output — no lane manifest is in_progress on main)

--- sync ---

$ pnpm ops:merge-wrapper git-rebase-main --issue UTV2-1830 --branch claude/utv2-1830-mission-stop-conditions
Successfully rebased and updated refs/heads/claude/utv2-1830-mission-stop-conditions.
[ops-merge-wrapper] the sync moved the head SHA 841fefb2946d306e397057cedc33c14b4d7a27ef -> 1485f4bc2083dd1c523d377ccee1ae7b6e981456,
which invalidates every head-pinned governance artifact on this branch: [...]
(No such artifact existed at that moment — no PR, no bundle, no EXECUTOR_RESULT, no verdict.
The warning is unconditional, not a measurement.)

--- static verification ---

$ pnpm verify
> env:check       exit 0
> lint            exit 0
> type-check      exit 0
> build           exit 0
> test            exit 0   AGGREGATE tests=5611 pass=5611 fail=0
> verify:commands exit 0
> test:live-db -> pnpm ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
  GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE  Command failed with exit code 1.

(The refusal is the containment control working, not a test failure. `pnpm verify` is not
obtainable on this machine by design: its last stage writes to a database, and
ci:assert-staging refuses any target that is not the staging project. Every stage before it
passed. The authoritative receipt is the required `verify` check on the PR.)
```

## Verification
- [x] `pnpm env:check`: PASS (exit 0)
- [x] `pnpm lint`: PASS (exit 0)
- [x] `pnpm type-check`: PASS (exit 0)
- [x] `pnpm build`: PASS (exit 0)
- [x] `pnpm test`: PASS (exit 0) — 5611 tests, 5611 pass, 0 fail, measured at this anchor
- [x] `pnpm verify:commands`: PASS (exit 0)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no rules matched
- [ ] `pnpm verify`: **not obtainable locally, and this box stays unchecked until the required
      `verify` check on the PR completes.** Every static stage above passed here; the chain then
      reaches `test:live-db`, where `ci:assert-staging` refuses a non-staging target under local
      containment by design, and the transcript above is that behaviour rather than a failure.
      The authoritative receipt is the required `verify` check on this lane's PR, run in the
      `staging-ci` GitHub environment. This box is unchecked because that run has not completed
      at the time of authoring — it is not a claim that anything failed.

## Runtime Verification

Not applicable and not claimed. This lane changes one agent instruction file and two mission
documents. It adds no code path, no schema, no workflow, and no runtime behavior — assertions A1
and A2 measure exactly that. No runtime proof is asserted, and none should be accepted as satisfied
for this bundle.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 1485f4bc2083dd1c523d377ccee1ae7b6e981456
