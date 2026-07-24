# Program Completion Definition

**Status:** Canonical contract — AUT-1
**Purpose:** An exact, falsifiable definition of "complete" for the whole Autonomous Delivery Control Plane
program (AUT-1 through AUT-6), tied to the program directive's own certification language: **"not complete
until T2/T3 unattended operation is certified in production use."** This document is written in the same
spirit as `EXECUTION_TRUTH_MODEL.md` §3's Done-State Law: an issue (or here, a program) is complete if and
only if a specific, checkable list of conditions holds — never on the basis of narrative, demo, or partial
success.

---

## 1. What "certified in production use" means, decomposed

The directive's phrase has three separate, independently-checkable components. All three must hold
simultaneously — a program that satisfies two of three is not complete.

1. **"T2/T3"** — scope is bounded exactly as `STATE_MACHINE.md`/`MODE_CONTRACT.md` define it: T1 is
   categorically excluded, always, from what is being certified.
2. **"Unattended operation"** — the kernel ran on its own schedule, without a human manually triggering each
   cycle, for a real, sustained window — not a single successful demo run.
3. **"Certified"** — a human (Griff) has reviewed checkable artifacts and explicitly signed off, per
   `EXECUTION_TRUTH_MODEL.md` §8's "PM reviews artifacts, not narratives" standard. Certification is an
   artifact (a specific, findable record), not a verbal or chat statement.

---

## 2. Falsifiable checklist

Every row below has a specific artifact or measurement that either exists and passes, or does not. There is
no row that can be satisfied by asserting it in a status update.

| # | Requirement | Checkable via |
|---|---|---|
| 1 | Kernel operated at `t2t3_live` mode continuously for a minimum of **30 consecutive days**, with no owner-forced halts except deliberate, logged maintenance windows | `mode_history` in `autonomy_execution_state_v1` — a continuous `t2t3_live` span with no unexplained `halted` entries in between |
| 2 | At least **20** distinct T2/T3 issues dispatched and merged autonomously during that window | Count of `dispatch_outcome` audit events with `outcome: "merged"` and `mode: "t2t3_live"` or `mode: "t3_live"` |
| 3 | **Zero** T1/Tier-C sensitive-path boundary violations across the entire window | `candidate_refused_sensitive_path` events show the guard *working* (a refusal is success, not failure); a violation would be a dispatch/merge event whose file scope, on later audit, is found to have touched a sensitive path — zero such findings required |
| 4 | **Zero** silent-fallback incidents (CLAUDE.md invariant 10: fail closed, never silent fallback to `qualified`/`pass`/`done`) held every cycle | Audit log grep for any event where a mechanical check's outcome is ambiguous/undetermined but the kernel proceeded as if it had passed — zero such findings required |
| 5 | Kill switch tested at least once during the window, with measured latency within the guaranteed bound (`KILL_SWITCH_CONTRACT.md` §2: ≤10 minutes to zero new mutating actions) | A `kill_switch_engaged`→`kill_switch_confirmed_halted` audit event pair with a timestamp delta at or under the bound, from a **real** engagement (a genuine test count, not a hypothetical) |
| 6 | Crash/restart recovery tested at least once (real incident or deliberate injection), with measured recovery matching `CRASH_RESTART_SEMANTICS.md`'s idempotency guarantee (no duplicate dispatch, no lost audit record) | `crash_recovery_reconciled` audit events showing a stale-heartbeat detection followed by correct reconciliation, with no corresponding duplicate `dispatch_outcome` for the same `idempotency_key` |
| 7 | T1 non-blocking guarantee validated empirically: at least one real T1 issue was Ready/awaiting Griff **simultaneously** with active, uninterrupted T2/T3 autonomous throughput | Overlapping timestamp ranges between a T1-Ready period (from Linear/digest history) and `dispatch_outcome` events showing continuous T2/T3 progress during that same range (`T1_QUEUE_BEHAVIOR.md` §4) |
| 8 | Both promotion steps that led to `t2t3_live` (`halted`→`shadow`→`t3_live`→`t2t3_live`) followed `PROMOTION_ROLLBACK_STANDARDS.md` §1's full criteria — no step skipped, no criterion waived | `mode_history` entries plus the linked owner-review artifact (Linear comment or equivalent) for each promotion |
| 9 | All 15 contracts in this document set (AUT-1) have been implemented by AUT-2 through AUT-6 with **no unresolved divergence** between contract and implementation | A tracked compatibility/divergence log (owned by whichever lane closes the program) with zero open entries; any divergence found during implementation is either fixed to match the contract or resolved via a PM-approved contract amendment — never silently shipped as-is |
| 10 | Griff has signed off in writing that unattended T2/T3 operation is certified for production use | A specific artifact: a Linear comment or `pm-verdict/v1`-equivalent record on the program's tracking issue, explicitly referencing this checklist and confirming each row — not a chat message (`EXECUTION_TRUTH_MODEL.md` §8: "Chat approval is not binding") |

---

## 3. Exit gate

The program's tracking Linear issue (or a dedicated closure issue, if the program spans issues 1:1 per lane
rather than one umbrella issue) moves to Done **only when every row in §2 has a linked, checkable artifact**.
Consistent with `EXECUTION_TRUTH_MODEL.md` §3's Done-State Law, the program is explicitly **not** complete on
the basis of:

- A successful demo or single clean run.
- Shadow-mode-only operation, no matter how long or clean.
- `t3_live`-only operation without reaching and sustaining `t2t3_live` for the full window.
- Any individual lane (AUT-2 through AUT-6) being merged — merging the code is necessary but not sufficient;
  the code must then run unattended for the full certification window and produce the artifacts in §2.
- PM verbal or chat approval without the written artifact in row 10.

---

## 4. Relationship to individual AUT-lane completion

Each of AUT-2 through AUT-6 has its own lane-level Done gate (`ops:truth-check`, per `EXECUTION_TRUTH_MODEL.md`
unchanged) — merging AUT-2's kernel code, for example, makes AUT-2 Done as a lane, but does **not** by itself
satisfy any row in §2 above, all of which require the merged system to have actually *run* for the
certification window. This document governs **program** completion, one level above individual lane
completion, exactly as `STATE_MACHINE.md` §4 draws the same one-level-up distinction for the state machine.
