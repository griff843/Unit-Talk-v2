# UTV2-1423 Diff Summary

Generated at: 2026-07-08T01:51:15.623Z
Issue: UTV2-1423
Tier: T1
Lane type: governance
Branch: claude/utv2-1423-canonical-merge-authority
PR URL: N/A
Head SHA: c003a5529962a1aeb77f38d926f6b22170fa1710
Merge SHA: N/A
Diff base: f1002b63881f9c7ba96d64429d5996b98c8de8ae
Diff target: c003a5529962a1aeb77f38d926f6b22170fa1710

## Git Diff Stat
```
.claude/commands/three-brain.md                |  3 +-
 .ops/sync/UTV2-1423.yml                        | 10 ++++
 CLAUDE.md                                      |  8 +--
 docs/05_operations/DELEGATION_POLICY.md        |  6 +--
 docs/05_operations/EXECUTION_TRUTH_MODEL.md    |  8 +--
 docs/05_operations/OPERATING_MODEL_SONNET5.md  | 22 ++------
 docs/05_operations/WORKFLOW_SPEC.md            |  2 +-
 docs/06_status/lanes/UTV2-1423.json            | 40 +++++++++++++++
 docs/06_status/proof/UTV2-1423/diff-summary.md | 71 ++++++++++++++++++++++++++
 docs/06_status/proof/UTV2-1423/verification.md | 48 +++++++++++++++++
 10 files changed, 188 insertions(+), 30 deletions(-)
```

## Git Name Status
```
M	.claude/commands/three-brain.md
A	.ops/sync/UTV2-1423.yml
M	CLAUDE.md
M	docs/05_operations/DELEGATION_POLICY.md
M	docs/05_operations/EXECUTION_TRUTH_MODEL.md
M	docs/05_operations/OPERATING_MODEL_SONNET5.md
M	docs/05_operations/WORKFLOW_SPEC.md
A	docs/06_status/lanes/UTV2-1423.json
A	docs/06_status/proof/UTV2-1423/diff-summary.md
A	docs/06_status/proof/UTV2-1423/verification.md
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: c003a5529962a1aeb77f38d926f6b22170fa1710
Merge SHA: N/A

## Summary

Resolved a five-way contradiction in T2 merge-authority language across `CLAUDE.md`,
`docs/05_operations/EXECUTION_TRUTH_MODEL.md`, `docs/05_operations/WORKFLOW_SPEC.md`,
`docs/05_operations/DELEGATION_POLICY.md`, `.claude/commands/three-brain.md`, and
`docs/05_operations/OPERATING_MODEL_SONNET5.md`. Docs variously claimed "no PM_VERDICT",
"explicit PM approval in the current chat session", and a Codex-lane-only carve-out.

The canonical rule was derived from the one place T2 merge authority is actually
mechanically enforced: `.github/workflows/merge-gate.yml`. That workflow accepts EITHER
a GitHub PR review with `state: APPROVED` (author unrestricted, so the orchestrator's own
`gh pr review --approve` after diff review satisfies it) OR a `pm-verdict/v1` APPROVED
comment from a CODEOWNERS human — for any executor, not scoped to Codex-authored lanes.

Root contradiction: `DELEGATION_POLICY.md`'s "Tier B — Review-before-merge" section
header itself asserted "merge requires explicit PM approval in the current chat
session" — the most direct violation of the fail-closed principle that chat approval
never satisfies a merge gate. Rewritten to state the mechanical rule and explicitly
disclaim chat-session approval. Also removed `OPERATING_MODEL_SONNET5.md`'s duplicated
restatement of `three-brain.md` Rule 9's escalation list (which had already drifted —
it still named T2 merge as needing explicit PM approval after `merge-gate.yml` made
self-approval sufficient); that document now points at `three-brain.md` as sole source.

## Scope

Docs-only change. No application code, package code, migrations, generated DB types,
workflow YAML, or runtime delivery paths were changed — `merge-gate.yml` itself was
read as ground truth but not modified; this lane brings prose in line with what it
already mechanically enforces.

## Known tooling gap surfaced during this lane

`pnpm ops:preflight` for a fresh T1 lane requires the proof directory to already exist
(PX5, non-waivable) but also fails if that directory exists without a complete,
`pnpm test:db`-referencing proof (PX3/PX4, non-waivable) — these two requirements
cannot both be satisfied before any work has been done. Worked around via manual
preflight token construction (documented precedent for cred-outage cases); this is a
tooling gap in `scripts/ops/preflight.ts` itself, out of this lane's declared file
scope, and should be filed as a follow-up issue rather than silently patched
lane-by-lane.
