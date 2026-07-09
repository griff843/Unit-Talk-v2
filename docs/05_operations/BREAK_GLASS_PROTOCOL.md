# Break-Glass Merge & PM Continuity Protocol

**Status:** Active
**Authority:** PM
**Issue:** UTV2-1493
**Effective:** date of merge to `main`

## PM-approved principle

> Emergency action may restore the last PM-approved safe state. Emergency action may not create new product/runtime authority.

Everything in this document is a narrow reading of that one sentence. Break-glass is a **rollback / pause / safe-state** lever, never a **new-change** lever. If an action would introduce new code, new schema, new data, or new customer-facing behavior into the system, it is out of scope for break-glass by definition — no matter how urgent it feels in the moment.

This document defines the only emergency continuity path when Griff (the sole PM approval authority per `.github/CODEOWNERS` and `docs/05_operations/schemas/pm-verdict-v1.md`) is unreachable. It does not create a second standing PM, does not weaken `.github/workflows/merge-gate.yml` or `ops:truth-check`, and does not touch branch protection. Those remain exactly as configured today. Break-glass is a documented, evidence-gated, time-boxed, mandatorily-reviewed *procedure* layered on top of the existing mechanics — not a change to the mechanics themselves.

## 1. When break-glass may be used

Break-glass may be invoked only when **all** of the following are true:

1. There is an active production emergency — a live incident materially harming customers, data integrity, security, or the ability to operate the system safely (e.g. the ingestor is corrupting data, a bad deploy is causing incorrect picks/settlements to reach members, a security exposure is live, a runaway process is degrading Supabase for all users).
2. The only action that resolves or contains the emergency is one of the **permitted actions** in Section 4 (rollback, pause, or restore to a prior PM-approved safe state) — not a new fix, not a new feature, not a forward migration.
3. Griff is unreachable within the response window defined in Section 2, and the invoker has documented a real attempt to reach him.
4. Waiting for normal PM review would materially increase the harm described in (1) beyond what the permitted action would prevent.

If any of these four is false, break-glass does not apply. Use the normal T1/T2/T3 lane flow, or if genuinely blocked, escalate and wait — do not invent a fifth condition in the moment.

Break-glass is **not** for: routine bugs, missed deadlines, backlog pressure, "PM is slow to respond" without a live emergency, or any situation where the correct action would be to ship new code, run a migration, or enable a new capability.

## 2. Who may invoke it

Exactly one standing invoker role exists today: **Claude, acting as orchestrator, in the current session, when it has independently verified conditions 1–4 in Section 1 and has documented the verification per Section 3.**

No other agent (Codex, a scheduled job, a webhook) may invoke break-glass. No human other than Griff may invoke it under this version of the protocol — a named human backup is not yet designated (see Section 8, Decision required). Until a human backup is named by PM, Claude-as-invoker is the only path, and Claude must still fail closed per Section 6 if evidence is incomplete.

This is deliberately narrow. Broadening the invoker list is itself a Rule 9 escalation (scope ambiguity affecting behavior) and must go through the decision process in Section 8, not be assumed by whoever is running the system that day.

## 3. Required evidence before invocation

Before taking any permitted action, the invoker must produce an **incident declaration artifact** at `docs/06_status/incidents/INC-<YYYYMMDD>-<NN>.md` containing:

```
# Incident Declaration

Incident ID: INC-<YYYYMMDD>-<NN>
Declared at: <ISO 8601 timestamp>
Declared by: <invoker identity>

## What is happening
<concrete description of the emergency, with evidence — logs, error output, affected rows/users/systems>

## Why this qualifies for break-glass
<map explicitly to Section 1 conditions 1-4>

## Griff unreachability evidence
- Attempt 1: <channel, timestamp, result>
- Attempt 2: <channel, timestamp, result>
(at least two attempts across at least two channels, spanning at least 30 minutes, required)

## Proposed permitted action
<exactly one action from Section 4, named explicitly, with the last-known-good state it restores to>

## Rollback-of-the-rollback plan
<what happens if the permitted action itself needs to be undone>
```

No incident declaration artifact means no break-glass action. This is the fail-closed gate (Section 6) — if the artifact cannot be produced with real evidence, the emergency is not sufficiently documented to proceed, and the system stays in its current (possibly degraded) state rather than taking an undocumented emergency action.

## 4. Permitted actions (emergency-only procedure)

Break-glass authorizes **only** the following, and nothing else:

- **Rollback** a specific deployed change (code, config, or data) to the last state that had a valid, completed `pm-verdict/v1: APPROVED` and green CI on its merge SHA.
- **Pause** a running process, scheduled job, ingestion pipeline, delivery/outbox worker, or promotion path — i.e. stop something from continuing to run, never start something new.
- **Restore** a system component to its last PM-approved safe configuration (e.g. re-enable a previously-approved governance brake, revert a feature flag to its last-approved value).

Explicitly **not** permitted under break-glass, ever, regardless of perceived urgency:

- Merging new code, even a "trivial" or "obviously correct" fix. New code always requires a normal lane and a normal (or, if this protocol is later extended, a break-glass-scoped) PM verdict — see Section 4a.
- Running or authoring a new database migration.
- Enabling or expanding any delivery/outbox/notification capability.
- Any pricing, payment, or customer-facing activation (new promotions, new pick visibility, new channel activation, new billing behavior).
- Any change to `.github/workflows/merge-gate.yml`, `.github/CODEOWNERS`, or branch protection settings.
- Any expansion of production deploy authority beyond what already exists for the invoker.
- Any action for which a "safe last state" cannot be concretely identified (if you cannot name the exact prior approved state you are restoring to, you cannot invoke break-glass for it).

### 4a. Merge mechanics during a break-glass action

Because break-glass never authorizes new code, most permitted actions do not require a merge at all — pausing a job or reverting a feature flag is typically an operational action, not a PR. When a rollback does require landing a revert commit (e.g. `git revert <merge-sha>` of a bad deploy):

- The revert PR still goes through the existing `merge-gate.yml` mechanics unmodified.
- If Griff can review it within the emergency's time budget, get a normal `pm-verdict/v1: APPROVED`.
- If Griff genuinely cannot review it in time (the condition that triggered break-glass in the first place), the invoker may use the existing `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md` emergency-exception path for that single revert commit — recording the same fields that policy already requires (incident ID, exact diff, why the PR path is too slow, rollback plan, authorizer) inside the incident declaration artifact from Section 3, which supersedes a separate bypass record. This protocol does not create a new bypass mechanism; it points at the one that already exists and narrows it to revert-only diffs.
- This is the only case where a break-glass action touches `main` outside a normal PR-and-verdict cycle, and it is bounded to "revert to a previously-approved SHA" — never a new diff.

## 5. Post-hoc PM review (mandatory, fixed window)

Every break-glass invocation, regardless of outcome, must be reviewed by Griff within **48 hours** of the incident declaration timestamp.

- The invoker must open (or reuse, if one already exists) a Linear issue referencing the incident ID and post the incident declaration artifact content plus a summary of the outcome as a comment.
- Griff's review posts one of:
  - **Ratified** — the action was justified, correctly scoped, and correctly executed. The lane can proceed to close (Section 7).
  - **Ratified with follow-up** — justified, but requires a follow-up lane (e.g. the underlying bug still needs a proper fix, or the incident revealed a gap in this protocol).
  - **Not justified** — the action did not meet Section 1's conditions, was out of scope for Section 4, or evidence was insufficient. This triggers mandatory incident postmortem and, if the action is still live, immediate reversal of the break-glass action itself.
- If 48 hours pass with no PM review, the incident auto-escalates: it must appear in `pnpm ops:digest` output as an overdue break-glass review, and the underlying lane/issue may not be marked Done under any circumstance until review completes. This is not a "soft" deadline — a missed window is itself a finding, not a lapse to quietly extend.

There is no path that skips this review. A break-glass action that is never reviewed is, by definition, not Done — per `docs/05_operations/EXECUTION_TRUTH_MODEL.md` §6, it stays open and reopens if anyone attempts to close it without a verdict.

## 6. Fail-closed rules

- No incident declaration artifact → no action.
- Fewer than two documented unreachability attempts across two channels, 30+ minutes apart → no action (Griff is not "unreachable" after one unanswered message).
- Proposed action is not one of the three permitted actions in Section 4, or the "safe state" being restored to cannot be named concretely → no action.
- Ambiguity about whether an action is rollback/pause/restore versus new capability → treat as new capability, decline break-glass, escalate and wait.
- Post-hoc review window (Section 5) missed → lane cannot close, appears in daily digest as overdue, escalates further rather than silently expiring.
- Any of the forbidden actions in Section 4 or the Do-Not list in the originating issue → hard stop, no exception, regardless of who is asking or how urgent it seems.

Silence, ambiguity, or missing evidence always resolves to **do not act** and escalate, never to a default "proceed."

## 7. Lane and truth-model mechanics (invariants preserved)

A break-glass action does not exempt itself from the standard invariants in `CLAUDE.md`:

- It still maps to exactly one issue and, where a PR is involved, one branch and one PR (Invariant 3).
- If no lane/issue exists yet when the emergency starts, the invoker creates one retroactively as part of Section 5's review, referencing the incident ID — the lane manifest remains the sole authority for active lane state (Invariant 6).
- Proof still binds to the actual merge SHA of any revert commit, never to a pre-incident branch-head SHA (Invariant 4).
- The tier label is still required before the lane can be marked Ready/Done — break-glass work defaults to T1 given its production-risk nature, applied via `ops:lane-finalize` as usual (Invariant 5).
- `ops:truth-check` still runs before Done; a break-glass merge is not Done until both `ops:truth-check` passes and the Section 5 post-hoc review is Ratified (Invariant 2).
- `main` remains shipped truth; the incident declaration and PM review are proof artifacts, not a substitute for what actually shipped (Invariant 1).

## 8. Decision required: invoker model (present, not pre-selected)

Section 2 currently names only "Claude as orchestrator" as invoker, because no human backup has been designated. Three models were considered for how this should evolve, and PM must choose — this protocol does not pick one unilaterally:

**Option A — Claude-only invoker (current default in this document).**
Simplest, no new human authority created, but the backstop for "what if Claude itself cannot reach Griff and cannot safely judge the emergency" is thin — it relies entirely on Claude correctly applying Sections 1 and 6.

**Option B — Named single human backup.**
PM designates one specific named individual (not a role like "on-call engineer") who may authorize a break-glass action when Griff is unreachable, using the same incident-declaration-and-48h-review mechanics. Requires PM to name a real person and to accept that person can see incident-declaration artifacts; does not require any CODEOWNERS or `merge-gate.yml` change since break-glass actions per Section 4a use the existing direct-main-bypass path, not a new merge-gate branch.

**Option C — Quorum of two non-PM reviewers.**
Two named individuals (or Claude + one named individual) must both sign the incident declaration before the action proceeds. Higher friction, slightly slower, but reduces single-judgment risk on both "is this really an emergency" and "is this really rollback-only."

This document ships with Option A as the operative default (since it requires no new named authority and is consistent with "no new product/runtime authority"). If PM prefers Option B or C, update Section 2 accordingly in a follow-up governance PR — this document does not need to be re-litigated end to end, only Section 2's invoker list.

## 9. Explicit non-goals (restated from the issue)

- This protocol does not create a normal-lane bypass. Every non-emergency change still goes through the standard T1/T2/T3 flow.
- This protocol does not expand production deploy authority for anyone, in any direction, beyond what exists today.
- This protocol makes no change to `.github/workflows/merge-gate.yml`, `.github/CODEOWNERS`, or branch protection settings. Any future mechanical enforcement of break-glass (e.g. a distinct comment schema recognized by CI) is a separate, separately-approved lane — not shipped here.
- This protocol does not bypass post-hoc PM review under any circumstance (Section 5).

## Relationship to other policies

This protocol does not weaken, and must be read alongside:

- `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md` — the existing emergency-exception mechanism this protocol narrows and reuses for revert-only diffs (Section 4a).
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — Done still requires `ops:truth-check` plus, for break-glass lanes, a Ratified post-hoc review.
- `docs/05_operations/DELEGATION_POLICY.md` — Tier C / always-escalate rules still apply; a break-glass decision is itself an always-escalate event per `three-brain.md` Rule 9 (scope ambiguity, source-of-truth conflict during the incident).
- `docs/05_operations/schemas/pm-verdict-v1.md` — the normal verdict schema is unmodified; break-glass does not introduce a competing verdict authority.

If any of these conflict with this document, use the stricter reading and escalate to PM — same rule as `DIRECT_MAIN_BYPASS_POLICY.md` already states for policy conflicts generally.
