# PROOF: UTV2-1721

MERGE_SHA: pending merge

Lane: governed harness refresh — re-admit the bounded mechanical corrections from PR #1429 without model-routing policy regression.
Tier: T1 · lane_type: governance · proof profile: static
Implementation anchor: `b71ca9239177c19c80da85ad2568990fe61ec31d`

## Summary

Seven files ported, eleven refused. Every explicit model/profile control is preserved. Two exact-head review findings from PR #1429 are corrected, and both corrections were validated **by execution**, not by assertion.

## Verification

ASSERTIONS:

- [x] `verify:static` green on the lane branch: env-check, lint, type-check, build, and the full unit suite — **4969 tests, 4969 pass, 0 fail, 0 skipped**.
- [x] `test:db` did not run locally: `ci:assert-staging` refused because this environment resolves Supabase to the containment sentinel `127.0.0.1` rather than staging `xskgrzbteyqdufktjrjx`. This is the fail-closed guard behaving correctly, not a lane failure, and `test:db` is not required for a `static` proof profile.
- [x] All six `model:` references in `.claude/commands/dispatch.md` are byte-identical to `origin/main` (L175, L181, L231, L242, L308, L326).
- [x] The eleven refused files are untouched: `git diff` against `origin/main` reports no change to any `.claude/agents/*.md`, `three-brain.md`, `OPERATING_MODEL_SONNET5.md`, or `agent-brief.md`.
- [x] T2 Merge Authority documentation now matches `.github/workflows/merge-gate.yml` L512-543 exactly — three approval artifacts, cited by line.
- [x] The corrected operator-runbook env procedure was executed across four cases, including a reproduction of the defect it fixes.
- [x] The corrected `bash-safety-guard` hook was observed blocking two real tool calls in-session.
- [x] No runtime code, schema, migration, or dependency change. Documentation and harness guidance only.

## Runtime Verification

EVIDENCE:

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

### 2. `test:db` refused by the staging-identity guard (expected under containment)

```text
> @unit-talk/v2@0.1.0 ci:assert-staging
> tsx scripts/ci/assert-staging-target.ts

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

### 4. Review finding B — env loading executed across four cases

The corrected procedure was run in an isolated temp directory. Case 3 reproduces the defect the fix closes.

```text
=== CASE 1: both present -> local.env wins AND child process sees it ===
  selected file : local.env
  child sees    : [local_env_wins]

=== CASE 2: only .env present -> documented fallback ===
  selected file : .env
  child sees    : [exported_ok]

=== CASE 3: bare source (the OLD advice) -> child must NOT see it ===
  shell var     : [local_env_wins]
  child sees    : []   <- empty proves the defect

=== CASE 4: neither file -> must fail closed ===
  local.env or .env is required.
  case4 exit=1 (1 = fails closed, correct)
```

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

## Out of scope, recorded

- `.claude/hooks/tier-c-path-guard.sh` documents exit 2 as "non-blocking" in its header while its own line 133 records the opposite. Same defect class, outside this lane's `file_scope_lock`.
- `bash-safety-guard.sh` matches destructive patterns in quoted/documentation text, not only in executable position (see §5). Not fixed here: this lane changes no matching logic.
- `CLAUDE.md`'s Merge Authority table carries the same omission `verification.md` had; it was absent from PR #1429's diff and is assigned to the CLAUDE.md rebuild successor lane.
