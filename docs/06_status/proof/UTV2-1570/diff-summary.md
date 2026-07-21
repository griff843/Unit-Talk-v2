# UTV2-1570 Diff Summary

Issue: UTV2-1570
Tier: T1
Lane type: governance
Branch: griffadavi/utv2-1570-implement-tier-c-authorization-gate-singleton-approval
Head SHA: 770df6ac (pre-push local head; see verification.md for the PR head SHA)
Diff base: origin/main

## Files changed

- `.claude/hooks/tier-c-path-guard.sh` — the manifest-authorized bypass branch stays `exit 0` (unchanged: still not a block), but now emits a structured `PreToolUse` JSON payload on stdout (`hookSpecificOutput.permissionDecision: "allow"`, `hookSpecificOutput.additionalContext`, top-level `systemMessage`) carrying the Tier C notice, instead of pure silence. The non-authorized (`exit 2`, blocking) and non-Tier-C (`exit 0`, no output) paths are unchanged.
- `.claude/hooks/tier-c-path-guard.test.sh` (new) — integration test / captured-behavior proof: invokes the hook binary directly with a manifest-authorized `PreToolUse` stdin payload, captures real stdout, and asserts it parses as JSON with the expected fields present and non-empty. Also asserts the un-authorized-block and non-Tier-C-passthrough paths are unchanged. 11 assertions, all passing.
- `docs/05_operations/schemas/tier-c-approval-v1.md` (new) — comment schema for authorizing a non-T1 lane to touch Tier C paths, mirroring `scope-override-v1.md`'s validation shape.
- `docs/05_operations/schemas/singleton-approval-v1.md` (new) — Linear-comment schema for singleton-path lane-start authorization, replacing the bare `--singleton-approved` flag.
- `scripts/ci/tier-c-approval-comment-parser.ts` (new) + `.test.ts` (new, 8 tests) — pure comment-body parser for `tier-c-approval/v1`, structurally mirroring `scope-override-comment-parser.ts`.
- `scripts/ci/tier-c-authorization-gate.ts` (new) + `.test.ts` (new, 10 tests) — the CI gate itself: imports `isTierCPath` directly from `scripts/ops/merge-risk.ts` (not a second Tier C path list), computes touched paths, and fails closed for non-T1 lanes touching a Tier C path without a valid, fully-covering `tier-c-approval/v1` comment.
- `.github/workflows/tier-c-authorization-gate.yml` (new) — wires the gate into CI: resolves the PR's authoritative tier from its lane manifest (same source `merge-gate.yml` treats as authoritative), collects changed files and approval comments via the GitHub API, resolves the gate script's full import graph (`tier-c-approval-comment-parser.ts`, `merge-risk.ts`, `shared.ts`, `concurrency-config.ts`) from a trusted `origin/main` mirror, and comments on failure.
- `docs/05_operations/REQUIRED_CI_CHECKS.md` — registers the new workflow as a required-check candidate (§5.6), same rollout pattern used for Proof Auditor Gate.
- `scripts/ops/singleton-approval.ts` (new) + `.test.ts` (new, 19 tests) — validates `--singleton-approval-ref <Linear comment URL>`: fetches the referenced comment live via the Linear GraphQL API, matches it by exact `url` equality (not by reconstructing a comment ID from the URL fragment, which is a truncated 8-char prefix of the full UUID — verified empirically against a real comment on this issue), confirms non-bot authorship, confirms the author is the issue's own `creator`, validates the fixed schema, and confirms full singleton-path coverage.
- `package.json` — adds `test:hooks` (runs the new hook integration test) to the `test` chain; adds the three new `.test.ts` files to `test:ops`.

## Explicitly not changed

- `scripts/ops/lane-start.ts` / `scripts/ops/lane-start.test.ts` — **not touched in this PR.** Both are currently held by another active, unrelated concurrent T1 lane's declared `file_scope_lock` (a Fable-pilot-routing lane, still open, PR #1292, awaiting its own PM review — unrelated to Tier C/singleton work). Editing either file here would create a hard file-scope-lock conflict, mechanically enforced by both `ops:lane-start`'s own concurrency check and CI's `file-scope-lock-check.yml`. `scripts/ops/singleton-approval.ts` is complete, fully tested, and ready to wire into `lane-start.ts`'s existing `--singleton-approved` check (around the line that currently reads `flags.has('singleton-approved') || bools.has('singleton-approved')`) as a small, mechanical follow-up once that file frees up. See `known_gaps` in `evidence.json`.
- `scripts/ops/tier-classifier.ts` — explicitly out of scope per the Linear issue (mechanical tier-classifier Phase 2 is a separately approved cutover).
- No branch-protection or repository ruleset setting changed. The new workflow is registered as a required-check *candidate* in `REQUIRED_CI_CHECKS.md`, not flipped live in GitHub branch protection — consistent with how Proof Auditor Gate was rolled out (candidate first, promoted after a confirmed green run).
- No other workflow file changed.
