# Mode Contract

**Status:** Canonical contract — AUT-1
**Purpose:** Precise definition of what the system is and is not allowed to do in each of the four modes
defined in `STATE_MACHINE.md` §2. Where `AUTHORITY_MATRIX.md` gives the cross-cutting actor × action view,
this document gives the per-mode narrative contract in full, so AUT-2 can implement a single `assertModeAllows(action)` guard per mode without re-deriving the rules from the matrix each time.

---

## `halted`

**Is:**
- The default/floor state. Zero autonomous behavior.
- Reachable from every other state instantly (`KILL_SWITCH_CONTRACT.md`).

**Is allowed to:**
- Read its own persisted state and the kill-switch flag.
- Emit exactly one audit event pair (`kill_switch_engaged` → `kill_switch_confirmed_halted`) confirming the
  halt took effect.
- Respond to a read-only status query (e.g. a digest read) with its current state.

**Is not allowed to:**
- Run any Gate 0-4 check.
- Evaluate candidates, even read-only.
- Emit a dispatch packet of any kind (real or shadow).
- Write to Linear, GitHub, or any lane manifest.
- Auto-promote itself out of `halted` under any condition. Only an explicit owner action exits this state.

---

## `shadow`

**Is:**
- The system's dry-run mode. Every mechanical step a live mode would take happens, except the final
  mutating call.
- The **only** way to validate the kernel's decision quality against real, current backlog state before any
  real authority is granted (`PROMOTION_ROLLBACK_STANDARDS.md` §1).

**Is allowed to:**
- Run Gate 0-4 exactly as a live mode would (same commands, same inputs, same pass/fail logic) — a shadow
  gate failure is logged identically to a live one.
- Build the full T2/T3 candidate queue, apply the sensitive-path check, apply concurrency/scope checks.
- Emit `dispatch_packet_v1` records with `dry_run: true` for every candidate that would have been dispatched
  in a live mode, and `candidate_refused_*` audit events for every candidate that would have been refused.
- Emit `shadow_decision` audit events summarizing what the cycle *would* have done.
- Auto-rollback is a no-op here (already floor of the rollback range — `shadow` only ever moves to `halted`,
  never further down).

**Is not allowed to:**
- Call `ops:lane-start`, open a PR, call `ops:merge-wrapper`, or write to Linear — under any condition,
  including a candidate that passed every check. The absence of any live mutating call is what makes this
  mode safe to run against a real, current backlog without PM pre-approval of each cycle.
- Consume any cost/token budget beyond what a normal read-heavy Gate 0-4 + candidate evaluation costs (no
  executor dispatch means no executor token spend in this mode).

**Promotion in:** `halted` → `shadow` is the lowest-stakes promotion in the system (still zero mutating
authority) and is expected to be the first one Griff grants.

**Promotion out:** to `t3_live`, gated by `PROMOTION_ROLLBACK_STANDARDS.md` §1 (minimum shadow duration,
zero threat-triggering events, owner review of a decision sample).

---

## `t3_live`

**Is:**
- The first mode with real, autonomous mutating authority — bounded to T3-tier work only, using exactly the
  merge authority (`EXECUTION_TRUTH_MODEL.md` §4: green CI + valid executor result, no PM verdict) already
  in place for T3 today.

**Is allowed to:**
- Everything `shadow` does, plus: for candidates that are T3-tier and pass every check, call
  `ops:lane-start`, dispatch to the resolved executor, open the PR, wait for green CI, and merge via
  `ops:merge-wrapper` — up to the per-cycle dispatch cap (`LIMITS.md` §3).
- Auto-rollback to `shadow` on defined triggers (`PROMOTION_ROLLBACK_STANDARDS.md` §2).
- Auto-halt on defined hard-stop conditions (`LIMITS.md` §4, §6) — this is a rollback straight to `halted`,
  not to `shadow`, and is distinct from the ordinary one-step rollback.

**Is not allowed to:**
- Dispatch, plan, or merge T2 or T1 work. A T2 candidate surfaced during this mode is logged as a shadow
  candidate for that tier only (visible for the promotion-readiness sample) but never acted on.
- Do anything in the never-permitted list (`AUTHORITY_MATRIX.md` §1) — tier does not override that list;
  a T3-labeled issue whose file scope touches a sensitive path is refused regardless of tier
  (`THREAT_MODEL.md` #3).

---

## `t2t3_live`

**Is:**
- The ceiling mode. The full autonomous authority this program ever grants — still strictly bounded to
  T2/T3, never T1.

**Is allowed to:**
- Everything `t3_live` does, plus: for candidates that are T2-tier, pass every check, and do not touch any
  sensitive path, dispatch and merge using the existing T2 merge authority (`gh pr review --approve` after
  diff review, or `pm-verdict/v1` — `EXECUTION_TRUTH_MODEL.md` §4).
- Auto-rollback to `t3_live` on defined triggers.
- Auto-halt straight to `halted` on hard-stop conditions, same as `t3_live`.

**Is not allowed to:**
- Anything involving T1. This is the ceiling specifically because it is the highest mode that still has a
  categorical "no" for T1 — there is no mode above this one that would relax that, ever (`STATE_MACHINE.md`
  §2.1).
- Grant itself, or request, T1 merge authority under any circumstance, including PM asking for it verbally
  in a session — a chat instruction does not amend this contract (`DELEGATION_POLICY.md` "Self-amendment,"
  `OPERATING_MODEL_SONNET5.md` §7 governance-change protocol). Extending this system to T1 would require a
  new, separately ratified contract superseding this one, not a mode addition.

---

## Cross-mode invariant

In every mode except `halted`, the kernel evaluates **every** cycle exactly as if it might dispatch — the
only thing that changes between `shadow` and the live modes is whether the final mutating call is actually
made. This is deliberate: it means the decision-quality code path is identical and continuously exercised
in `shadow` before it is ever trusted with real authority, and identical again once trusted — there is no
separate "shadow-only" decision logic to drift from the "live" decision logic.
