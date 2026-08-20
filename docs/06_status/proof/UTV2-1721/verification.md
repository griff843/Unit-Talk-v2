# PROOF: UTV2-1721

MERGE_SHA: pending merge

Lane: governed harness refresh — re-admit the bounded mechanical corrections from PR #1429 without model-routing policy regression.
Tier: T1 · lane_type: governance · proof profile: static
Substantive anchor: `a5d4ac5159da2944351fc3f3d16d840d3c31b1d5` (the sanctioned `pr-update-branch` commit that refreshed this branch onto current `main`)

## Summary

Seven files ported, eleven refused. Every explicit model/profile control is preserved. Two exact-head review findings from PR #1429 are corrected, and both corrections were validated **by execution**, not by assertion.

## Verification

ASSERTIONS:

- [x] `verify:static` green on the lane branch: env-check, lint, type-check, build, and the full unit suite — **4969 tests, 4969 pass, 0 fail, 0 skipped**.
- [x] The T1 database gate is **satisfied, not waived**: `pnpm test:db` and the T1 live-proof suite ran against the approved staging project on this exact head and passed (run 32329786908, job 96308159380). It does not run on this workstation, where `ci:assert-staging` correctly refuses the containment sentinel `127.0.0.1`; the receipt is therefore cited from CI.
- [x] All six `model:` references in `.claude/commands/dispatch.md` are byte-identical to `origin/main` (L175, L181, L231, L242, L308, L326).
- [x] The eleven refused files are untouched: `git diff` against `origin/main` reports no change to any `.claude/agents/*.md`, `three-brain.md`, `OPERATING_MODEL_SONNET5.md`, or `agent-brief.md`.
- [x] T2 Merge Authority documentation now matches `.github/workflows/merge-gate.yml` L512-543 exactly — three approval artifacts, cited by line.
- [x] The corrected operator-runbook env procedure was executed across four cases, including a reproduction of the defect it fixes.
- [x] The corrected `bash-safety-guard` hook was observed blocking two real tool calls in-session.
- [x] No runtime code, schema, migration, or dependency change. Documentation and harness guidance only.

## Runtime Verification

EVIDENCE:

### 0. Gate commands executed, verbatim

```text
$ pnpm verify
  -> verify:static PASS (env:check, lint, type-check, build, full unit suite)
  -> test:db REFUSED by ci:assert-staging under credential containment (see §2)
  -> overall exit 1, attributable solely to the containment refusal

$ pnpm type-check
  -> clean

$ pnpm test
  -> tests=4969 pass=4969 fail=0 skipped=0

$ npx tsx scripts/ci/r-level-check.ts --issue UTV2-1721
  Verdict: PASS
  Changed files: 13
  Rules matched: (none) - no R-level artifacts required for this diff

$ npx tsx scripts/ops/proof-auditor-gate.ts --proof-dir docs/06_status/proof/UTV2-1721 --sha b71ca9239177c19c80da85ad2568990fe61ec31d
  Verdict: PASS

$ npx tsx scripts/ci/proof-binding-validator.ts --proof-dir docs/06_status/proof/UTV2-1721 --issue UTV2-1721
  evidence_commit_sha / current_pr_head_sha: resolved by CI, no sentinels remaining
  proof-binding-validator: PASS
```

`pnpm verify` is reported here in full rather than only its green `verify:static` prefix: the run does exit non-zero, and the sole cause is the staging-identity refusal quoted in §2. No test, lint, type-check or build failure occurs.


### 1. Static verification — full unit suite green

```text
> @unit-talk/v2@0.1.0 verify:static
> env:check   -> Environment files passed validation.
> lint        -> eslint . --cache                  (clean)
> type-check  -> pnpm exec tsc -b tsconfig.json    (clean)
> build       -> (clean)
> test        -> aggregate across all test groups:
                 tests=4969 pass=4969 fail=0 skipped=0
```

### 2. T1 database gate — satisfied by a passing staging run, not waived

An exact-head review raised this correctly: `AGENTS.md:250-255` states that T1 issues **always** require `pnpm test:db`, and a `static` proof profile does not waive it. The previous revision of this bundle recorded only that `test:db` was refused locally under credential containment, which is not evidence that the gate was met.

It was met. `pnpm test:db` and the full T1 live-proof suite executed against the approved staging project on this exact head and passed:

```text
Workflow: CI -> Writable DB proof (staging only)
Run:      32329786908   Job: 96308159380   Attempt: 1
Head:     a5d4ac5159da2944351fc3f3d16d840d3c31b1d5
Result:   SUCCESS

[assert-staging] OK: target is the approved staging project ***

  pnpm test:db  ->  apps/api/src/database-smoke.test.ts
# tests 7
# pass 7
# fail 0
# skipped 0

  pnpm test:t1-proof:live  ->  t1-proof-awaiting-approval.test.ts
# tests 5
# pass 5
# fail 0
# skipped 0

  ... continuing across the enumerated T1 live-proof suite, e.g.
# tests 20
# pass 20
# fail 0
# skipped 0
```

The local refusal quoted below remains true of this workstation and is retained because it explains why the receipt is cited from CI rather than reproduced here — it is not an argument that the gate does not apply:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
GitHub environment with CI_SUPABASE_* credentials.
```

### 3. Review finding A — the T2 authority mechanism, read from the workflow

`.github/workflows/merge-gate.yml`, T2 branch. The workflow's own error string enumerates all three paths:

```text
516: const approvals = reviews.filter(r => r.state === 'APPROVED');
521: // Check for pm-verdict/v1 APPROVED from an authorized CODEOWNERS member
526: return lines[0] === 'PM_VERDICT: APPROVED' && lines[1] === 'schema: pm-verdict/v1';
528: // Check for a valid executor-result/v1 self-attestation from an authorized member
533: return lines[0] === 'EXECUTOR_RESULT: READY_FOR_REVIEW' && lines[1] === 'schema: executor-result/v1';
535: if (!hasPmVerdictApproval && !hasExecutorResultAttestation) {
537:   'T2 requires a pm-verdict/v1 APPROVED comment from a CODEOWNERS member, ' +
538:   'a GitHub PR review approval, or an executor-result/v1 self-attestation comment ' +
539:   'from a CODEOWNERS member.'
```

PR #1429 documented two paths and asserted orchestrator self-approval satisfies the gate. Path 3 exists because author and reviewer share the `griff843` identity, so GitHub refuses that self-review.

### 4. Review finding B — env layering executed against the real loader semantics

An exact-head review found the first correction still wrong. `loadEnvironment()` (`packages/config/src/env.ts:175-191`) does not select one file: it parses `.env.example`, `.env` and `local.env` and merges them **per variable**, later layers overriding earlier. A first-match loop stops at `local.env` and silently drops every credential that lives only in `.env` — the common local layout. The runbook now reproduces the layered merge, verified by execution:

```text
=== CASE 1: layered merge - all three present ===
  SHARED (local wins)      : [from_local]
  ONLY_ENV (survives!)     : [env_val]
  ONLY_EXAMPLE (survives)  : [example_val]
  ONLY_LOCAL               : [local_val]

=== CASE 2: the REJECTED first-match loop, same files ===
  ONLY_ENV : []   <- EMPTY: .env credentials silently dropped

=== CASE 3: no layers -> fail closed ===
  no env layer found: expected at least one of .env.example, .env, local.env
  case3 exit=1 (1 = fails closed)
```

Case 2 is the defect this correction removes, and it is the behaviour the previous revision of this lane shipped. The earlier "four cases" evidence described that superseded procedure and has been replaced rather than retained, so no part of this bundle documents a procedure the runbook no longer contains.

### 5. Hook exit-2 semantics — the control observed blocking two live calls

The ported `bash-safety-guard.sh` denied two real tool calls during this lane's own work, emitting the new message text. The pre-port copy on `main` documents this same exit code as a "non-blocking warning", which the observed behaviour contradicts:

```text
PreToolUse:Bash hook error: [bash .claude/hooks/bash-safety-guard.sh]:
SAFETY BLOCK: Destructive pattern blocked — rm -rf
This call was denied (fail-closed). If the operation is genuinely required:
  - use the sanctioned script for it (e.g. ops:lane-clean for worktree removal,
    ops:merge-wrapper for branch ops), or
  - ask the operator to run or explicitly approve the exact command.
Do not retry the same command verbatim. Hook: bash-safety-guard.
```

The exit code and matching logic are unchanged by this port; only the comment and the operator-facing message change. The documentation now matches observed behaviour. This is corroborated inside the repository itself: `.claude/hooks/tier-c-path-guard.sh:133` already records "Exit 2 was previously used here but Claude Code blocks on any non-zero exit."

**Observed false-positive class (new finding, out of scope here).** The second block fired while *authoring this very document*, because the guard matches the destructive pattern anywhere in the command text — including inside a quoted heredoc documenting the guard's own output. It cannot distinguish executing a destructive command from writing about one. Recorded below rather than fixed, since `bash-safety-guard.sh` matching logic is deliberately unchanged in this lane.

### 6. Model-control preservation

```text
$ git diff origin/main -- .claude/commands/dispatch.md | grep -E '^[+-].*model:'
(no output — no model: line added or removed)

$ grep -n 'model:' .claude/commands/dispatch.md
175: ... Use `model: "sonnet"` (Sonnet 5) for all T1 work ...
181:   model: "sonnet",
231:   ... Planning model: sonnet ...
242:   model: "sonnet",
308:   model: touchesTierC ? "opus" : "sonnet",  // tier C paths → opus critique
326: **Tier C detection:** ... use `model: "opus"`. Otherwise `model: "sonnet"`.
```

### 7. Review finding C — gate-sequence parity must not strip the loop's Linear check

The parity instruction added to `/dispatch` originally said the three gate sequences "must stay identical" and that `/dispatch` wins on divergence. `/loop-dispatch` invokes `pnpm ops:substrate-guard --check-linear` while `/dispatch` and `/dispatch-board` invoke it bare, so an agent following that instruction could have deleted the loop's Linear drift check in the name of parity.

`dispatch.md:52` documents what the flag buys: "(with `--check-linear`) a Linear/manifest conflict". Parity is now scoped to gate composition and order, and the flag is named as an intentional loop-only addition in both files:

```text
$ grep -n 'check-linear' .claude/commands/dispatch.md .claude/commands/loop-dispatch.md
dispatch.md:42:      Parity governs which gates run, not their flags. ... **Do not remove
                    `--check-linear` from `/loop-dispatch` in the name of parity**
loop-dispatch.md:28: One intentional difference: this loop runs
                    `ops:substrate-guard --check-linear` ... Keep the flag.
```

No command's executed gate sequence changed; only the instruction that governs future edits.

## Out of scope, recorded

- `.claude/hooks/tier-c-path-guard.sh` documents exit 2 as "non-blocking" in its header while its own line 133 records the opposite. Same defect class, outside this lane's `file_scope_lock`.
- `bash-safety-guard.sh` matches destructive patterns in quoted/documentation text, not only in executable position (see §5). Not fixed here: this lane changes no matching logic.
- `CLAUDE.md`'s Merge Authority table carries the same omission `verification.md` had; it was absent from PR #1429's diff and is assigned to the CLAUDE.md rebuild successor lane.
