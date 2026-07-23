# Notification Taxonomy

**Status:** Canonical contract — AUT-1
**Purpose:** Exactly which events notify Griff, at what severity, through what channel — and, critically,
which events do **not**, so the system does not become noisy (`THREAT_MODEL.md` #4). The non-notify list in
§3 is as binding as the notify list in §2.

---

## 1. Channels

| Channel | Used for | Notes |
|---|---|---|
| **Daily digest** (`ops:daily-digest`, existing mechanism per `EXECUTION_TRUTH_MODEL.md` §8) | All `info`/`medium` events, aggregated | The kernel does not create a second digest — it feeds its own section into the existing one (`COMPATIBILITY_MAP.md`). |
| **Dedicated Linear tracking issue** for the autonomy kernel | `high` and `critical` events, individually | One persistent Linear issue (created once, referenced by ID in AUT-2/AUT-4's own config) that the kernel comments on. Griff can watch/subscribe to exactly one issue for kernel escalations instead of parsing the digest for them. |
| **GitHub issue with label `autonomy:critical`** | `critical` events only | A new GitHub issue per critical event (not reused/edited), labeled for easy filtering, so a critical event is visible even to someone who only watches the GitHub repo and not Linear. |
| **Audit log** (`schemas/audit_event_v1.schema.json`) | Every event, regardless of notification decision | The audit log is not a notification channel — it is the source of truth every notification is derived from. Every notified event has a corresponding audit event; not every audit event produces a notification. |

**Explicitly excluded as a channel:** Discord (public or member-facing) and any smart-form surface. Per
`DELEGATION_POLICY.md`'s always-escalate list ("Discord channel activation or new delivery targets"), this
system must never post operational/status content to a member-visible surface — that would itself be a
member-visible behavior change requiring its own PM-gated decision, wholly outside this program's scope.

---

## 2. Notify list (individual, not digest-only)

| Event | Severity | Channel | Rationale |
|---|---|---|---|
| Kernel auto-halt (consecutive failures, cost ceiling, audit integrity) | `critical` | Linear tracking issue + GitHub issue (`autonomy:critical`) | The system has stopped itself — Griff needs to know now, not tomorrow's digest, whether he intends to investigate immediately or not. |
| Audit log integrity failure (hash-chain break or sequence gap) | `critical` | Linear tracking issue + GitHub issue (`autonomy:critical`) | Distinct from auto-halt in cause, identical in urgency — the record of what happened can no longer be trusted. |
| Sensitive-path refusal (`THREAT_MODEL.md` #3 firing) | `high` | Linear tracking issue comment | Either a misclassification or an attempted-escalation signal worth eyes on, even though the refusal itself worked correctly. |
| Crash recovery found an ambiguous/partially-applied action (`CRASH_RESTART_SEMANTICS.md` §2 step 3) | `high` | Linear tracking issue comment | The kernel deliberately does not guess a corrective action here — a human must look. |
| 2+ `high` severity events within 24h (rollback-trigger escalation threshold reached but not yet at auto-halt) | `high` | Linear tracking issue comment | Surfaces a pattern before it reaches the auto-halt threshold, giving Griff a chance to intervene earlier. |
| Mode auto-rollback (kernel stepped itself down one mode) | `medium` | Digest, plus one Linear tracking issue comment | Not urgent (the system correctly protected itself), but distinct enough from routine operation to warrant a standalone note rather than being buried in an aggregated count. |

---

## 3. Digest-only / non-notify list

These generate **zero individual notifications**. They are visible in the daily digest, aggregated, and
fully present in the audit log — but never interrupt Griff individually.

| Event | Why it does not need individual notification |
|---|---|
| Cycle start / cycle end (routine heartbeat) | Expected, constant background operation — a ping per cycle at a 15-minute cadence would be pure noise. |
| "No eligible candidates this cycle" (kernel idle) | Fully expected steady state; not informative on its own. |
| Successful individual T3 (or T2, in `t2t3_live`) dispatch and merge | This is the system working exactly as designed. Per `THREAT_MODEL.md` #4, pinging on every success is what causes fatigue that buries the events that matter. Aggregated as a count + list in the digest. |
| Dispatch refused due to ordinary concurrency/scope conflict | Routine, expected, self-resolving on the next cycle — identical in kind to a human-invoked `/dispatch` hitting the same conflict today, which also does not page anyone. |
| T1 issue newly Ready / T1 backlog tally (`T1_QUEUE_BEHAVIOR.md` §2) | T1 never blocks anything and always requires Griff's own review cadence regardless of urgency framing — pinging on every new T1 item would train Griff to ignore kernel pings, which is worse than no ping for the events that truly need his attention. |
| Reopen detected (`ops:truth-check` exit 4) | Already covered by the **existing** daily digest mechanism (`EXECUTION_TRUTH_MODEL.md` §8) — the kernel does not duplicate this notification, only ensures kernel-originated reopens are correctly tagged as kernel-originated within that existing flow. |
| Mode promotion **eligibility** reached (readiness criteria satisfied, but promotion itself always requires explicit owner action — `PROMOTION_ROLLBACK_STANDARDS.md` §1) | Surfaced as a digest recommendation, not urgent — promotion is never time-sensitive from the system's side, only from Griff's own schedule. |
| Kill-switch engaged confirmation (`kill_switch_confirmed_halted`) | Griff just did this himself — notifying him that his own action took effect is redundant. Visible in the audit log and digest for the record, not pushed. |
| Kernel crash with **clean** recovery (no ambiguous/partial action found in reconciliation) | The system healed itself correctly — this is the auto-recovery working as designed, not an escalation. Contrast with the `high`-severity ambiguous-recovery case in §2, which is the one crash-recovery outcome that does notify. |
| Preflight/gate pass confirmations (Gate 0-4 all green) | Routine confirmation that nothing was blocking — not informative unless something *was* blocking, which is covered elsewhere. |

---

## 4. Design rule for future additions

Any new event type added to `audit_event_v1.schema.json`'s enum must be explicitly placed into either §2 or
§3 of this document as part of the same change — an event type with no notification classification is a
gap, not a default-to-silent or default-to-notify choice. This keeps the taxonomy exhaustive rather than
letting new event types silently fall through to whatever the implementation happens to default to.
