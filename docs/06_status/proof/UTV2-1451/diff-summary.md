# UTV2-1451 — Outcome Contract / Design (spec-first, per existing precedent for this class of change)

Generated: 2026-07-21
Revision: corrected Loophole 1's PreToolUse notice mechanism per PM review on UTV2-1570 (2026-07-21)
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

**Design (corrected a second time — see note below; this revision replaces a still-wrong
"print to stdout" proposal from the previous revision):**
1. The manifest-authorized case **must stay at `exit 0`**, not move to `exit 2`. The hook's own
   current comment (`.claude/hooks/tier-c-path-guard.sh` line ~144) documents why: exit 2 blocks the
   write outright pending confirmation — an earlier revision of this exact hook used exit 2 here and
   had to be changed to exit 0 for that reason. This was independently corroborated live in this
   session: the orchestrator's own `git reset --hard` tripped `bash-safety-guard.sh`'s exit-2 path,
   and the command did not execute — the orchestrator had to switch to `git switch -C` to avoid the
   hook entirely, confirming exit 2 is blocking in practice, not merely a documented risk. So "always
   exit 2 regardless of authorization, changing only the message" is not viable: it would re-block
   every legitimate T1 Tier C lane, the failure mode the manifest-authorized bypass exists to avoid.

   **The previous revision of this design proposed fixing the silence by printing the Tier C notice
   to plain stdout before `exit 0`. That proposal was itself wrong** (flagged directly by PM review
   on UTV2-1570) and must not ship: a `PreToolUse` hook's stdout is parsed as JSON **only on exit
   0**, and only specific recognized JSON fields are surfaced anywhere — arbitrary non-JSON text
   printed to stdout is silently discarded by Claude Code, never shown in the transcript, the
   session, or any log a human or future agent would see. "Print to stdout" is not a fix for the
   silence; it reproduces it under a different name.

   **Corrected mechanism:** on `exit 0`, print a single JSON object to stdout using the documented
   `PreToolUse` hook output schema — set `hookSpecificOutput.permissionDecision` to `"allow"` (making
   the allow decision explicit rather than implicit-via-silence) with a `hookSpecificOutput.
   additionalContext` string carrying the Tier C notice (e.g. `"Tier C notice: <path> — <reason> —
   authorized via manifest <issue_id> file_scope_lock"`), and additionally set a top-level
   `systemMessage` field with the same notice. `additionalContext` is injected into Claude's own
   context at the point the tool call fires, so it is visible in-transcript to the executing agent;
   `systemMessage` is the general-purpose "warning shown to the user" field and is not
   `PreToolUse`-specific, so setting both covers agent-visible and user-visible surfacing without
   relying on a mechanism scoped to only one audience. Concretely:
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "permissionDecision": "allow",
       "permissionDecisionReason": "Manifest-authorized Tier C write (UTV2-NNN file_scope_lock)",
       "additionalContext": "TIER-C NOTICE: <path> — <reason> — authorized via active lane manifest UTV2-NNN"
     },
     "systemMessage": "TIER-C NOTICE: <path> — <reason> — authorized via active lane manifest UTV2-NNN"
   }
   ```
   This closes the "no warning surfaced at all" half of the loophole (silence) without reintroducing
   a local block — the real mechanical enforcement for the non-T1 case lives in CI (item 2 below),
   not in the local hook's exit code.

   **Confidence and sources (per PM instruction on UTV2-1570 to verify rather than assert):**
   HIGH confidence, not empirically instrumented against a live transcript from within this lane
   (this design-only lane does not touch the hook, and there is no available mechanism to observe a
   hook's effect on this session's own transcript from inside the task that produced it). Basis:
   (a) the official current Claude Code hooks reference at `code.claude.com/docs/en/hooks`, fetched
   directly this session, which states explicitly: "Exit 0 means success. Claude Code parses stdout
   for JSON output fields... JSON output is only processed on exit 0"; "Exit 2 means a blocking
   error... PreToolUse blocks the tool call"; `hookSpecificOutput` for `PreToolUse` supports
   `permissionDecision` (`allow`/`deny`/`ask`/`defer`), `permissionDecisionReason`,
   `additionalContext`, and `updatedInput`; `systemMessage` is a universal JSON field ("warning
   message shown to the user") requiring exit 0. (b) In-repo empirical precedent: this exact repo's
   own shipped hooks already use the `{"systemMessage": "..."}` exit-0 JSON pattern successfully —
   `.claude/hooks/session-start.sh`, `.claude/hooks/post-compact-reinjector.sh`,
   `.claude/hooks/linear-sync-reminder.sh`, `.claude/hooks/commit-msg-linear-check.sh`, and
   `.claude/hooks/untracked-scripts-check.sh` all emit `systemMessage` JSON on exit 0, and
   `session-start.sh`'s output is what populates this session's own auto-injected system-state
   context today — i.e., the mechanism is not merely documented, it is already load-bearing
   elsewhere in this repo's hook set. Neither of these hooks is `PreToolUse`, so the specific
   `additionalContext` field's `PreToolUse`-scoped behavior is verified from documentation only, not
   from an in-repo running example — the implementation lane (UTV2-1570) must still include an
   integration test or captured behavior proof of the exact `PreToolUse` JSON payload actually
   surfacing (transcript capture or equivalent), per the acceptance criteria below, rather than
   trusting this design's confidence level as sufficient proof on its own.
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

**Files:** `docs/05_operations/schemas/tier-c-approval-v1.md` (new), `scripts/ci/tier-c-authorization-gate.ts` (new, follow-up), `scripts/ci/tier-c-authorization-gate.test.ts` (new, follow-up), `.claude/hooks/tier-c-path-guard.sh` (small edit: keep `exit 0` for the manifest-authorized branch, emit the `hookSpecificOutput.additionalContext` + `systemMessage` JSON payload described above — do **not** change it to `exit 2`, and do **not** substitute a naive stdout `echo` for the structured JSON payload), plus a new `.claude/hooks/tier-c-path-guard.test.sh` (or equivalent) that captures the hook's actual stdout for a manifest-authorized invocation and asserts it is valid JSON containing the expected `hookSpecificOutput.additionalContext`/`systemMessage` fields — this is the "integration test or captured behavior proof" acceptance criterion below, not optional polish.

**Acceptance criteria addition for UTV2-1570 (per PM correction — this is now a hard requirement, not a nice-to-have):** the implementation PR must not merely change the hook's stdout and assert it "looks right" by inspection. It must include either (a) an automated test that invokes the hook binary directly with a manifest-authorized `PreToolUse` JSON stdin payload, captures real stdout, and asserts it parses as JSON with the expected `hookSpecificOutput.permissionDecision`/`additionalContext` and top-level `systemMessage` fields present and non-empty, or (b) an equivalent captured-behavior proof (e.g., a recorded transcript excerpt showing the notice actually surfaced) attached to the T1 evidence bundle. A design or comment asserting the mechanism "should" work per documentation, without a captured test/proof artifact, does not satisfy this criterion — this is the exact failure mode this design's own previous ("print to stdout") revision fell into.

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
