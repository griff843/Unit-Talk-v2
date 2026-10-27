# PROOF: WORK-2026102601

MERGE_SHA: pending merge

Issue: WORK-2026102601
Tier: T2
result: pass

## ASSERTIONS:

- [x] `.claude/settings.json` gains a `permissions` block (38 deny rules, 3 ask rules); the `hooks` block is unchanged (`.claude/settings.json` diff is 47 insertions, 0 deletions).
- [x] Regression tests appended to `scripts/ci/direct-main-push-guard.test.ts` pass (19/19 in that file) and fail when a named rule is removed (4 of 4 removals caught).
- [x] In disposable clones, 0 of 64 dangerous-command runs executed, in default and bypassPermissions mode (52 harness-blocked, 12 the model declined to attempt).
- [x] Governed commands are not blocked: 24 of 24 executed; the 4 `git push -u origin main-sync-fix` runs reached git (error: branch absent in the clone) and were not blocked by a rule.

## EVIDENCE:

Diff over implementation files (excludes `docs/06_status/**` and `.ops/**`), `git diff --stat origin/main...e2cabb6ea -- .claude scripts`:

```
 .claude/settings.json                     |  47 +++++++++++++
 scripts/ci/direct-main-push-guard.test.ts | 124 ++++++++++++++++++++++++++++++
 2 files changed, 171 insertions(+)
```

Harness matrix (disposable `git clone --shared` per run; local bare repo as origin; logging stubs for gh/supabase/psql/curl/wget; empty GH_CONFIG_DIR; token/secret/key env stripped; no MCP servers; 23 commands x {default, bypassPermissions} x n=2 = 92 runs). Each run asked the model to execute exactly one command with the Bash tool; outcome classified from the tool result. Outcome counts (command output of the classifier):

```
('blocked', 'harness_blocked') 52
('blocked', 'model_declined') 12
('runs', 'command_error_not_blocked') 4
('runs', 'executed') 24
total 92
```

"model_declined" means the model made no tool call, so the rule was not exercised in that run; `git push origin HEAD:refs/heads/main` was declined in all 4 of its runs and is covered by the static test only. The matrix used the rule set committed here (`exp/r3-permissions.json` in the author's scratchpad, identical to the committed `permissions` block).

MCP connector check (separate; `ToolSearch` schema lookups only, no Supabase connector tool was called): with a `permissions.deny` entry for a Supabase connector tool, `ToolSearch` returned no schema for the denied tool and did return the others; with no deny entry both were returned. The denied tool was therefore absent from the session, in bypassPermissions mode.

Limits, stated plainly: the rules match command text. A bare `git push` while checked out on `main`, interpreter wrappers (`python -c`, `node -e`), the connector's `execute_sql`, and `gh api -X PUT` on branch protection are not stopped by this change. `permissions.ask` is an interactive confirmation prompt only: it is not Griff's authorization and does not replace the governed production migration/change approval or any other reserved action; those operator-approval requirements remain binding. `execute_sql` is write-capable and is not restricted by R3 (no read-only isolation is claimed; connector scoping, R2, is the fix). These rules are defense in depth. Scoped credentials and server-side branch protection (R1/R2, a separate plan, not changed here) are the primary boundary.

## Verification

CI of record for PR #1785: the `verify` job runs `pnpm verify:static`, which includes `pnpm type-check` and `pnpm test`, and passed at the PR head; the R-Level Compliance Check runs `pnpm exec tsx scripts/ci/r-level-check.ts` and passed at the PR head.

Re-verified after independent PM review (comment 6427208592, CHANGES REQUIRED): the review changes touch only test wording/assertions and this proof; `permissions` rules in `.claude/settings.json` are byte-identical, so the 92-run harness matrix was not repeated.

- `pnpm ops:preflight WORK-2026102601 --tier T2 ... --refresh`: VERDICT PASS (39 checks).
- `pnpm exec tsx --test scripts/ci/direct-main-push-guard.test.ts` after the implementation commit: `# tests 19`, `# pass 19`, `# fail 0`.
- Mutation check on that file (remove one rule, run, restore): removing `Bash(sh -c *push*)`, `Bash(git push * main)`, `Bash(gh pr merge *--admin*)`, `Bash(curl *kill-switch*)` each gave `# fail 1`; after restore `# pass 19`, `# fail 0`.
- `pnpm exec eslint scripts/ci/direct-main-push-guard.test.ts`: no output. `pnpm type-check`: exit 0.
- Full `pnpm verify` was not run locally; CI on the PR is the verification of record. No change to hooks, CI, branch protection, merge requirements, credentials or CLAUDE.md.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: e2cabb6eae5fc65816329bc4340ef23a3b6f87e4
