# UTV2-1423 Diff Summary

Branch-head SHA (pre-merge): `192a635cd38e119e376c236ce737756243db6523`

## Summary

Resolved a five-way contradiction in T2 merge-authority language across `CLAUDE.md`,
`docs/05_operations/EXECUTION_TRUTH_MODEL.md`, `docs/05_operations/WORKFLOW_SPEC.md`,
`docs/05_operations/DELEGATION_POLICY.md`, `.claude/commands/three-brain.md`, and
`docs/05_operations/OPERATING_MODEL_SONNET5.md`. Docs variously claimed "no PM_VERDICT",
"explicit PM approval in the current chat session", and a Codex-lane-only carve-out.

The canonical rule was derived from the one place T2 merge authority is actually
mechanically enforced: `.github/workflows/merge-gate.yml`. That workflow (T2 path
ratified 2026-05-18 under UTV2-979) accepts EITHER a GitHub PR review with
`state: APPROVED` (author unrestricted, so the orchestrator's own
`gh pr review --approve` after diff review satisfies it) OR a `pm-verdict/v1`
APPROVED comment from a CODEOWNERS human — for any executor, not scoped to
Codex-authored lanes.

## Files changed

- `CLAUDE.md` — Verification expectations table: T2 Merge Authority column now states
  "GitHub PR review approval or `pm-verdict/v1` APPROVED comment"; added a footnote
  naming `merge-gate.yml` as the single mechanical source of truth and defining
  approval artifacts explicitly (label / review / comment — never chat).
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — Tier Model table: same T2 fix,
  same mechanical-source footnote.
- `docs/05_operations/WORKFLOW_SPEC.md` — Done-gate line rewritten to point at the
  canonical CLAUDE.md table + merge-gate.yml instead of restating a stale
  "orchestrator on green (T2/T3)" summary.
- `docs/05_operations/DELEGATION_POLICY.md` — three fixes:
  1. Sprint-tier alignment table's T2 row: removed the Codex-lane-only framing,
     replaced with the universal `gh pr review --approve` / `pm-verdict/v1` rule.
  2. **Root contradiction**: the "Tier B — Review-before-merge" section header
     itself asserted "merge requires explicit PM approval in the current chat
     session" — this was the most direct violation of the fail-closed principle
     that chat approval never satisfies a merge gate. Rewritten to state the
     mechanical rule and explicitly disclaim chat-session approval.
  3. The "T2 clear-scope Codex lane merges" standing authorization (originally
     granted 2026-05-14, narrower than what UTV2-979 later made universal)
     marked superseded/generalized to match what `merge-gate.yml` enforces for
     every T2 PR regardless of executor.
- `.claude/commands/three-brain.md` — Rule 9's "Mandatory merge gates" list
  removed "T2 merge — explicit PM approval required" (this bullet made T2 a
  stop-and-escalate condition, contradicting both `merge-gate.yml`'s self-approval
  path and Delegation Policy's own Tier B bounded-autonomy model). T1 plan/merge
  remain mandatory Rule 9 gates.
- `docs/05_operations/OPERATING_MODEL_SONNET5.md` — removed the full duplicated
  restatement of Rule 9's escalation list (which had already drifted — it still
  named T2 merge as needing explicit PM approval after `merge-gate.yml` made
  self-approval sufficient). Replaced with a pointer to `three-brain.md` as sole
  source, plus an explicit T2-is-not-a-stop-condition note.

## Scope

Docs-only change. No application code, package code, migrations, generated DB
types, workflow YAML, or runtime delivery paths were changed — `merge-gate.yml`
itself was read as ground truth but not modified; this lane brings prose in line
with what it already mechanically enforces.

## Known tooling gap surfaced during this lane

`pnpm ops:preflight` for a fresh T1 lane requires the proof directory to already
exist (PX5, non-waivable) but also fails if that directory exists without a
complete, `pnpm test:db`-referencing proof (PX3/PX4, non-waivable) — these two
requirements cannot both be satisfied before any work has been done. Worked
around per documented precedent (manual preflight token construction); this is a
tooling gap in `scripts/ops/preflight.ts` itself, out of this lane's declared
file scope, and should be filed as a follow-up issue rather than silently patched
lane-by-lane.
