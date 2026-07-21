# UTV2-1451 — Outcome Contract / Design (spec-first, per existing precedent for this class of change)

Generated: 2026-07-21
Issue: UTV2-1451 (Close Tier C / singleton / risk-class self-authorization loopholes, G-07)
Tier: T1
Branch: claude/utv2-1451-close-self-authorization-loopholes

## Scope of this lane (per PM verdict)

This lane is **design-only**: spec + a PM-sanctioned deferred implementation via a linked child
issue. It does **not** close the Tier C or singleton self-authorization loopholes described below.

Per PM verdict on PR #1289, a concrete, T1-tier, dispatch-ready blocking implementation child issue
has been created for the two genuinely unaddressed loopholes (Tier C path guard self-authorization;
`--singleton-approved` bare flag): **the child issue implementing loopholes 1 and 2 below is
UTV2-1570** ("Implement Tier C authorization gate + singleton approval record (UTV2-1451 child)"),
linked as blocking this issue in Linear, with acceptance criteria drawn directly from the designs
below. Real enforcement of these loopholes is pending that child's own dispatch, review, and PM
approval — not part of this lane's own Done criteria.

## Why spec-first, not a rushed implementation

This lane closes three self-authorization loopholes, one of which (mechanical T2 risk-class
derivation) is largely already addressed: `scripts/ops/tier-classifier.ts` (Phase 1, advisory-only)
is already implemented and running in CI as the "Tier Classifier (advisory)" check, per the
PM-ratified `docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md` (UTV2-1494). That spec
explicitly locks Phase 2 (making it blocking) as **a separate follow-up requiring its own PM
approval** — it must not ship bundled with another lane's implementation. This document does not
bundle a Phase 2 cutover; it verifies Phase 1 is real and scopes what Phase 2 would need.

The other two loopholes (Tier C self-authorization via the local hook, and `--singleton-approved`
being a bare trusted flag) are genuinely unaddressed. Given this is T1 governance-critical work
whose entire point is closing a self-authorization gap, shipping a rushed fix under time pressure
that itself has a subtle self-authorization hole would be worse than a properly scoped design
handed to a careful implementation pass. Same precedent as UTV2-1494: spec now, implementation
(this lane or a follow-up) after the design is legible enough to review in one pass.

## Loophole 1: Tier C path guard silently authorizes via self-declared scope

**Location:** `.claude/hooks/tier-c-path-guard.sh` (local Claude Code PreToolUse hook, not a CI
gate). Lines ~19-40 (manifest lookup) and ~144-149 (`if [ -n "$manifest_authorized" ]; then exit 0`).

**Real mechanism:** the hook checks whether the target file appears in the CURRENT branch's own
active lane manifest's `file_scope_lock`. Since the agent itself writes that manifest at
`ops:lane-start` time, an agent can pre-authorize its own Tier C writes simply by declaring the
path in its own scope up front — the hook then exits 0 silently, with no warning surfaced at all.
This is a real-time editing guard, not a merge gate; `scripts/ops/merge-risk.ts`'s
`TIER_C_EXACT_PATHS`/`TIER_C_PATH_PREFIXES` matrix is the correct single source of truth for what
counts as Tier C here (per UTV2-1494's PM-locked decision that both mechanisms must read one list).

**Design (corrected — see note below):**
1. The manifest-authorized case **must stay at `exit 0`**, not move to `exit 2`. The hook's own
   current comment (`.claude/hooks/tier-c-path-guard.sh` line ~144) already documents why: exit 2
   blocks the write outright pending confirmation ("Claude Code blocks on any non-zero exit") — an
   earlier revision of this exact hook used exit 2 here and had to be changed to exit 0 for that
   reason. So "always exit 2 regardless of authorization, changing only the message" (this design's
   original proposal) is not viable: it would re-block every legitimate T1 Tier C lane, the same
   failure mode the manifest-authorized bypass exists to avoid. The corrected fix: keep `exit 0` for
   the manifest-authorized path, but still print the Tier C notice to **stdout** (not stderr) before
   exiting 0, so the notice is visible in the session transcript/logs without requiring
   confirmation. This closes the "no warning surfaced at all" half of the loophole (silence) without
   reintroducing a local block that `exit 2` would cause — the real mechanical enforcement for the
   non-T1 case lives in CI (item 2 below), not in the local hook's exit code.
2. The **mechanical, blocking half** moves to where it belongs: CI, not a local hook a developer
   session could route around entirely (e.g., by disabling hooks, which `PG8`'s preflight check
   already watches for separately). Add a new required check,
   `scripts/ci/tier-c-authorization-gate.ts` (wired into a new or existing workflow), that:
   - Computes touched paths via `git diff --name-only` (same mechanism `r-level-check.ts` and
     `tier-classifier.ts` already use).
   - Filters to `isTierCPath()` matches (imported from `merge-risk.ts`, not a new list).
   - If any match and the lane's manifest `tier` is not already `T1` (which already carries the
     full `t1-approved` + `pm-verdict/v1` gate via `merge-gate.yml`), require a new PR comment
     schema, `tier-c-approval/v1` (`docs/05_operations/schemas/tier-c-approval-v1.md`, this lane),
     mirroring `scope-override/v1`: `Issue:`, `PR:`, `Head-SHA:`, `Paths:` (must cover every
     matched Tier C path), from a CODEOWNERS human, non-bot, exact-head-bound — same validation
     shape `scope-override/v1` already uses, so there is exactly one trust primitive in this repo
     for "a human explicitly authorized touching a specific path on a specific head," not two.
   - Missing/mismatched artifact → hard fail, same failure shape as `file-scope-guard.ts`.
3. A T1 lane touching Tier C paths needs no additional artifact — its own `t1-approved` +
   `pm-verdict/v1` gate already is PM sign-off on the exact head, which necessarily covers
   whatever the diff touches. The gap is specifically **T2/T3 lanes silently touching Tier C via
   self-declared scope** with no comparable scrutiny; that's what the new gate closes.

**Files:** `docs/05_operations/schemas/tier-c-approval-v1.md` (new), `scripts/ci/tier-c-authorization-gate.ts` (new, follow-up), `scripts/ci/tier-c-authorization-gate.test.ts` (new, follow-up), `.claude/hooks/tier-c-path-guard.sh` (small edit: keep `exit 0` for the manifest-authorized branch, add a stdout notice — do **not** change it to `exit 2`, per the corrected design above).

## Loophole 2: `--singleton-approved` is a bare, unverified CLI flag

**Location:** `scripts/ops/lane-start.ts:401` — `flags.has('singleton-approved') ||
bools.has('singleton-approved')` is the entire check. Any value on the flag, from any caller,
passes.

**Design:** `--singleton-approved` alone is deprecated to a warning-only legacy path (kept for one
release for backward-compat scripts, always logged, never sufficient alone). The real check
becomes `--singleton-approval-ref <Linear-comment-URL>`, validated against a new
`scripts/ops/singleton-approval.ts`:
1. Fetches the referenced Linear comment via the existing GraphQL pattern `preflight.ts` already
   uses (`fetchLinearIssue`'s query shape, extended to fetch `comments`).
2. Validates the comment body matches a fixed schema (`SINGLETON_APPROVED`, `Issue:`, `Paths:`
   covering every singleton path being claimed) and that `comment.user.id` matches the issue's
   known human owner (`createdById`) — i.e., an artifact that had to be posted by the actual issue
   owner, not generated inline by the same automated flow requesting the lane.
3. `lane-start.ts` calls this validator instead of trusting the flag; on any failure (comment
   missing, schema mismatch, wrong author, paths not fully covered), fails closed with
   `singleton_approval_invalid`, same shape as today's `singleton_path_conflict`.

This is deliberately Linear-comment-based rather than GitHub-PR-comment-based: singleton approval
is needed at `lane-start` time, before any PR exists, so the artifact must be checkable pre-PR —
Linear issue comments are.

**Files:** `scripts/ops/singleton-approval.ts` (new), `scripts/ops/singleton-approval.test.ts`
(new), `scripts/ops/lane-start.ts` (the one-line check at line 401 replaced with a call into the
new validator), `scripts/ops/lane-start.test.ts` (new/updated cases).

## Loophole 3: T2 risk class self-classified (dispatch-board.md)

**Location:** `.claude/commands/dispatch-board.md`'s risk-class table (~lines 190-208) — a prose
table the orchestrator (Claude) reads and applies to itself; nothing mechanically checks the
classification against the actual diff.

**Status: substantially already addressed, do not duplicate.** `scripts/ops/tier-classifier.ts`
(Phase 1, advisory) already computes a mechanical `derived_tier = max(declared_tier,
mechanical_minimum(diff))` from real touched paths against the shared `TIER_C_*` matrix, and is
already wired as the non-blocking "Tier Classifier (advisory)" required-adjacent check (confirmed
running on live PRs this session — verified via GitHub API, not assumed). What remains, per
`MECHANICAL_TIER_CLASSIFIER_SPEC.md` §"Phase 2," is:
1. A baseline/sweep report (run the classifier against recent merged PRs and currently open
   lanes, publish counts of what it would have flagged) — **not found in the repo as of this
   writing**; this is a real, missing deliverable of Phase 1's own completion criteria, independent
   of Phase 2.
2. The Phase 2 cutover itself (`merge-gate.yml` consuming `derived_tier` instead of
   `authoritativeTier` for blocking purposes) — explicitly gated behind its own, separate PM
   approval per the locked spec. **Not proposed as part of this lane.**

`dispatch-board.md`'s table should be updated to point at the classifier as the authoritative
mechanical floor for anything Phase 2 eventually covers, with the prose table remaining as
human-readable guidance for the PM-gate *type* (which artifact) once tier is known — not as the
tier-determination mechanism itself. That's a small doc edit, not new code.

## Sequencing recommendation

1. This design doc (now).
2. UTV2-1570 (linked, blocking this issue, T1, dispatch-ready) — the concrete implementation PR
   for loopholes 1 and 2 (concrete code + tests per the designs above). This is the next actionable
   unit of work on this issue, and closes the loopholes this issue names; this design-only lane
   does not.
3. Separately, generate the Phase 1 sweep report (bounded, mechanical, no design decisions needed)
   — could be its own small T2/T3 lane, unblocks evaluating Phase 2 cutover readiness.
4. Phase 2 cutover proposal — its own PM-gated decision, per the locked spec; not this lane's job.

## Owner boundary

T1 — governance-critical, self-authorization-loophole closure. This document is design/investigation
only; no runtime, workflow, or hook behavior has changed yet. Requires the `t1-approved` label and
a Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head before any of the
follow-up code changes land, per existing T1 merge authority.
