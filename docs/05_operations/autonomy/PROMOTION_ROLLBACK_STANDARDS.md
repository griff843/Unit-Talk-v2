# Promotion and Rollback Standards

**Status:** Canonical contract — AUT-1
**Purpose:** How a mode promotion is decided, and how a rollback is triggered. The core asymmetry governing
this entire document: **promotion is always owner-only and never automatic; rollback may be kernel-initiated
for a fixed, enumerated set of triggers.** The kernel can only ever move itself *down*, never up.

---

## 1. Promotion criteria

Every promotion step (`halted`→`shadow`, `shadow`→`t3_live`, `t3_live`→`t2t3_live`) requires **all** of the
following before Griff takes the explicit promotion action. None of these criteria are self-certified by the
kernel — they are checkable against the audit log and execution-state history, the same "artifacts, not
narrative" standard `EXECUTION_TRUTH_MODEL.md` §8 already applies to lane PM review.

| Criterion | `halted` → `shadow` | `shadow` → `t3_live` | `t3_live` → `t2t3_live` |
|---|---|---|---|
| Minimum time at current mode | None (starting state) | **7 consecutive days**, or **20 completed cycles**, whichever is longer | **7 consecutive days**, or **20 completed cycles** at `t3_live`, whichever is longer |
| Zero `critical`-severity events during the window | N/A | Required | Required |
| Zero unresolved `high`-severity events during the window (resolved = acknowledged + root-caused, not just "went away") | N/A | Required | Required |
| Kernel auto-rollback count during the window | N/A | 0 | 0 |
| Owner review of a decision sample | N/A | Griff reviews a sample of `shadow_decision` audit events (what the kernel *would* have dispatched) and confirms the decisions look correct — this is a real read of real records, not a rubber stamp | Griff reviews a sample of actual T3 dispatch/merge outcomes from the `t3_live` window |
| Explicit owner action | Required (sets mode via the same mechanism as the kill switch's Layer 1, in reverse) | Required | Required |

**Rationale for 7 days / 20 cycles:** long enough to see the kernel's behavior across a realistic mix of
backlog conditions (not just one lucky day), short enough that Griff isn't stuck evaluating for months
before getting any real signal. This mirrors the calibration-disclosure stance in `LIMITS.md` — a
conservative starting point, not an empirically-tuned final number.

**No skipping steps.** `halted` cannot promote directly to `t3_live` or `t2t3_live` — every promotion moves
exactly one step (`STATE_MACHINE.md` §2.2), so the shadow-validation step is never bypassable even under
time pressure.

---

## 2. Rollback triggers (kernel-initiated, always move down exactly one step)

Any of the following, detected by the kernel itself during a live mode (`t3_live` or `t2t3_live`), causes an
**immediate, automatic** one-step rollback (`t2t3_live`→`t3_live` or `t3_live`→`shadow`). This is not
optional or PM-gated — a rollback is a safety action, not a policy decision, and does not wait for
confirmation.

| Trigger | Detection |
|---|---|
| Any single `critical`-severity event that is not itself an auto-halt condition | `audit_event_v1` severity field |
| 2+ `high`-severity events within a rolling 24h window | Count query against the audit log |
| Any `THREAT_MODEL.md` mitigation firing more than once within a rolling 24h window (e.g. sensitive-path refusal triggering twice) | Per-mitigation counter, reset on window roll |
| Rolling 24h cost ceiling reached (`LIMITS.md` §6) | `cost_counters` in execution-state |
| A T3 (or T2, in `t2t3_live`) merge is reverted within 24h of the kernel merging it | Requires the kernel to watch for a revert commit referencing its own merge SHA — implementation detail for AUT-2/AUT-5, but the trigger condition itself is fixed here |

A rollback trigger firing **twice in a row** (i.e. the kernel rolls back, and a trigger fires again before a
human has intervened) escalates to full auto-halt per `LIMITS.md` §4's consecutive-rollback-trigger
threshold (2) — the kernel does not keep stepping down indefinitely on repeated triggers; two strikes and it
stops entirely.

**Owner rollback is separate and unconditional.** Griff may roll back at any time, for any reason, with no
justification required and no criteria to satisfy — this is not the same mechanism as the kernel's
auto-rollback (which requires an enumerated trigger); it is the same unconditional authority as the kill
switch, just targeting a one-step-down transition instead of `halted` directly. Every rollback (owner or
kernel) is recorded in `mode_history` with `actor` distinguishing which.

---

## 3. What rollback does NOT do

Consistent with `KILL_SWITCH_CONTRACT.md` §3's scope principle: a rollback changes what the kernel is
allowed to do **going forward**. It does not retroactively touch anything already dispatched or merged under
the higher mode — those lanes/PRs are left exactly as they are for human review, same as the kill switch's
"does not auto-clean-up" rule.

---

## 4. The core asymmetry, stated explicitly

| Direction | Who can initiate | Automatic? | Requires enumerated trigger? |
|---|---|---|---|
| **Promotion** (up) | Owner only | Never | N/A — never automatic regardless of criteria met |
| **Rollback** (down, one step) | Owner or kernel | Owner: no. Kernel: yes | Kernel: yes, fixed list in §2. Owner: no, unconditional. |
| **Halt** (down, to floor, from any state) | Owner (kill switch) or kernel (hard auto-halt conditions) | Owner: no. Kernel: yes, for `LIMITS.md` §4 conditions only | Kernel: yes, fixed list. Owner: no, unconditional. |

**Meeting promotion criteria never causes promotion by itself.** The criteria in §1 make a promotion
*eligible* — surfaced to Griff as a digest recommendation (`NOTIFICATION_TAXONOMY.md` §3) — but the kernel
has no code path that transitions its own mode upward under any circumstance, including "all criteria have
been satisfied for a long time and nobody has acted on it." This is the single most load-bearing rule in
this entire contract set for keeping the system's ceiling of authority genuinely owner-controlled rather
than a formality that erodes over time.
