# Portable Hook Orchestration Layer

This document is the single orchestration contract for existing `.claude/hooks/**` scripts. It inventories the current hooks, defines a portable wrapper contract, and preserves current governance ownership boundaries without replacing or duplicating any hook implementation.

## 1. Inventory table

| Hook name | Trigger point | Purpose | Advisory vs blocking | Windows/POSIX compatible? |
| --- | --- | --- | --- | --- |
| `artifact-drift-check.sh` | `PostToolUse` | Warn when generated artifacts are written under `src/` or when `PROGRAM_STATUS.md` is edited and Linear sync may be needed | Advisory today. Exits `2` for surfaced warning, `0` otherwise | Partial. POSIX shell works; depends on `bash`, `cat`, `grep`, and `python3`. On Windows this is Git Bash compatible, not native PowerShell portable |
| `bash-safety-guard.sh` | `PreToolUse` | Detect destructive shell patterns such as `git reset --hard`, `git clean -f`, `rm -rf`, and unqualified `DELETE FROM` | Advisory today. Exits `2` for surfaced warning, `0` otherwise | Partial. POSIX shell works; depends on `bash`, `grep`, and `python3`. Windows requires a Unix-like shell and `python3` on `PATH` |
| `commit-msg-linear-check.sh` | Commit intent check before/around `git commit` command submission | Remind the operator to include a Linear close marker when committing from a `UTV2-*` branch | Advisory. Always exits `0` and emits a JSON `systemMessage` only when needed | Partial. Uses `bash`, `git`, `grep -P`, `head`, and `tr`. `grep -P` portability is weaker across Windows Git environments |
| `linear-sync-reminder.sh` | `PostToolUse(Bash)` | Remind the operator to mark the Linear issue done after `gh pr merge` | Advisory. Always exits `0` | Partial. Uses `bash`, `grep`, and `head`. Works in POSIX shells and Windows Git Bash, not as a native PowerShell script |
| `post-compact-reinjector.sh` | `PostCompact` | Reinject compact session state after context compaction so lane and working-tree state are not lost | Advisory. Always exits `0` | Partial. Uses `bash`, `git`, `pwd`, `wc`, `tr`, `node`, and `python3`. Windows support depends on Git Bash plus Node/Python availability |
| `session-start.sh` | `UserPromptSubmit` | Generate and inject a compact local system-state summary when the cached state is stale | Advisory. Always exits `0` | Partial. Uses `bash` with `set -euo pipefail`, plus `git`, `date`, `grep`, `sed`, `wc`, `tr`, `node`, `mkdir`, `cat`, and `python3`. Not native PowerShell portable |
| `session-summary.sh` | Stop hook | Print a compact summary of changed files and active-lane snapshot freshness at session end | Advisory. Always exits `0` | Partial. Uses `bash`, `git`, `wc`, `tr`, `head`, `sed`, `grep`, and `node`. Requires Unix-like tooling on Windows |
| `suggest-test-group.sh` | `PostToolUse` | Suggest the most relevant `pnpm` test group from an edited file path | Advisory today. Exits `2` for surfaced suggestion, `0` otherwise | Partial. Uses `bash`, `grep`, and `python3`. Windows requires Git Bash or equivalent |
| `tier-c-path-guard.sh` | `PreToolUse` for `Write|Edit` | Warn before edits to Tier C sensitive paths and surface manifest-based authorization context when present | Advisory today, but governance-critical. Exits `2` for surfaced warning, `0` otherwise | Partial. Uses `bash`, `grep`, `sed`, `git`, and `python3` with a grep/sed fallback. Works in POSIX shells and Windows Git Bash with tool availability |

## 2. Portable hook contract spec

The portable orchestration layer should treat each hook as a declarative unit with the following fields:

| Field | Meaning |
| --- | --- |
| `name` | Stable hook identifier, usually the script basename such as `tier-c-path-guard` |
| `trigger` | Canonical lifecycle point where the hook runs, for example `PreToolUse`, `PostToolUse`, `PostCompact`, `UserPromptSubmit`, `Stop`, or commit-intent review |
| `authority` | Ownership boundary for the rule enforced by the hook. Values should include at least `governance`, `implementation`, or `operator-assist` |
| `failure-semantics` | Orchestrator interpretation of exit behavior. `blocking` means fail closed and stop the action on non-zero exit. `advisory` means always allow the action and surface guidance to the operator |
| `platform` | Execution target declaration. Recommended values: `posix`, `windows-git-bash`, `cross-platform-wrapper`, or `native-powershell` |

Recommended portable manifest shape:

```yaml
name: tier-c-path-guard
trigger: PreToolUse
authority: governance
failure-semantics: advisory
platform: windows-git-bash
```

The orchestration layer must remain singular. This document is the canonical contract; do not introduce a second orchestration registry or parallel hook-classification document.

## 3. Category classification

| Hook name | Primary category |
| --- | --- |
| `session-start.sh` | pre-implementation |
| `bash-safety-guard.sh` | pre-implementation |
| `tier-c-path-guard.sh` | pre-implementation |
| `suggest-test-group.sh` | post-implementation validation |
| `artifact-drift-check.sh` | proof validation |
| `commit-msg-linear-check.sh` | PR review |
| `linear-sync-reminder.sh` | PR review |
| `post-compact-reinjector.sh` | lane closeout |
| `session-summary.sh` | lane closeout |

Category intent:

- `pre-implementation`: guardrails before code or command execution.
- `post-implementation validation`: targeted feedback after edits or commands.
- `proof validation`: evidence-quality checks that catch drift or missing operator follow-through.
- `PR review`: merge and close-intent reminders tied to commit or PR workflow.
- `lane closeout`: state preservation and end-of-session continuity.

## 4. Failure semantics

Portable orchestration must normalize hook outcomes into two modes only:

- Blocking hooks fail closed. Any non-zero exit stops the triggering action and must emit a clear remediation message that tells the operator what to fix next.
- Advisory hooks always exit `0` at the orchestration boundary, even if the underlying script uses an internal warning code such as `2`. The warning or suggestion is surfaced, but execution continues.

Current state:

- Every existing hook in `.claude/hooks/**` is advisory in practice.
- Hooks that currently use exit `2` are warning-producing advisory hooks, not hard blockers.
- If any hook is promoted to blocking later, the remediation text must be explicit and actionable, not just a generic failure banner.

## 5. Windows/PowerShell compatibility notes per hook

| Hook name | Compatibility note |
| --- | --- |
| `artifact-drift-check.sh` | Bash script with `python3` JSON parsing. Path normalization handles backslashes, but native PowerShell cannot execute it directly without a wrapper |
| `bash-safety-guard.sh` | Shell pattern matching is portable in POSIX environments; Windows portability depends on Git Bash and `python3` |
| `commit-msg-linear-check.sh` | Uses `grep -P`, which is the least portable construct in the current inventory and may fail in slimmer Windows grep builds |
| `linear-sync-reminder.sh` | Simple enough for a future PowerShell port, but currently shell-only because it relies on bash and POSIX text tools |
| `post-compact-reinjector.sh` | Uses `pwd`, `wc`, `tr`, `node`, and `python3`; best treated as Git Bash compatible rather than PowerShell native |
| `session-start.sh` | Highest shell-surface area in the inventory. `date`, `sed`, here-doc output, and `set -euo pipefail` make it POSIX-centric |
| `session-summary.sh` | Uses POSIX text utilities and assumes Git commands can be piped through `wc`, `head`, and `sed` |
| `suggest-test-group.sh` | Path normalization is Windows-aware, but execution still requires bash and `python3` |
| `tier-c-path-guard.sh` | Includes the best current Windows fallback because it can parse JSON without `python3`, but it still depends on bash, `grep`, and `sed` |

Portable wrapper guidance:

- Prefer a single orchestrator that can dispatch to bash scripts on POSIX and Windows Git Bash.
- If native PowerShell support is required later, add wrappers around the existing scripts instead of duplicating the governance logic in a second orchestration path.
- Preserve current hook names and trigger semantics so there is no duplicate orchestration layer.

## 6. Governance ownership note

The following hooks are governance-owned and must not be reassigned to Codex:

| Hook name | Ownership note |
| --- | --- |
| `tier-c-path-guard.sh` | Governance-owned. Not Codex-delegatable because it protects Tier C path authority and manifest-based authorization boundaries |
| `artifact-drift-check.sh` | Governance-owned. Not Codex-delegatable because it protects artifact hygiene and operator proof discipline |

Governance rule:

- `tier-c-path-guard.sh` and `artifact-drift-check.sh` must remain explicitly marked as governance-owned, not Codex-delegatable, in any future orchestration manifest or wrapper layer.
