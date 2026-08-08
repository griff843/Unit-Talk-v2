# Autonomy Contracts — AUT-1

**Status:** Canonical, ratified pending Codex adversarial review + PM sign-off (see
`docs/06_status/autonomy/STATUS.md`)
**Produced by:** UTV2-1577 (AUT-1), lane of the Autonomous Delivery Control Plane program (AUT-1 .. AUT-6)
**Authority:** These documents are the binding integration contract for AUT-2 (kernel implementation),
AUT-3 (bootstrap), AUT-4 (scheduler), and AUT-5/AUT-6 (execution/certification). Code diverging from these
contracts is a bug in the code, not a reinterpretation — a genuine need to diverge is a contract-amendment
proposal (`OPERATING_MODEL_SONNET5.md` §7 governance-change protocol), not a silent implementation choice.

This lane (AUT-1) builds **only** these contracts. It does not implement any kernel code, scheduler, or
bootstrap logic — see the parent program directive and `docs/06_status/autonomy/STATUS.md` for what each
subsequent lane owns.

---

## What this system is

A durable "Autonomous Delivery Control Plane": a control loop that wakes itself on a schedule, safely
dispatches T2/T3 Linear work through the existing lane apparatus, never touches T1 (which always requires
Griff), resumes safely after a crash, classifies blockers mechanically, and can be killed by Griff with a
guaranteed, bounded latency. It never grants itself T1, production, or credential authority, under any mode,
permanently.

## Reading order

For someone implementing AUT-2/AUT-3/AUT-4, the recommended read order is:

1. `STATE_MACHINE.md` — the two state machines (Mode, Cycle) everything else hangs off of.
2. `MODE_CONTRACT.md` — precise per-mode behavior.
3. `AUTHORITY_MATRIX.md` — the never-permitted list and mode × actor action table.
4. `KILL_SWITCH_CONTRACT.md` — exact mechanism, latency, scope.
5. `LIMITS.md` — concrete numbers.
6. `CRASH_RESTART_SEMANTICS.md` — liveness signal, recovery procedure, idempotency.
7. `T1_QUEUE_BEHAVIOR.md` — the non-blocking guarantee.
8. `THREAT_MODEL.md` — concrete threats mapped to concrete mitigations, mostly citing the documents above.
9. `NOTIFICATION_TAXONOMY.md` — notify vs. digest-only.
10. `PROMOTION_ROLLBACK_STANDARDS.md` — how mode changes are decided and triggered.
11. `PROGRAM_COMPLETION_DEFINITION.md` — the falsifiable definition of program Done.
12. `COMPATIBILITY_MAP.md` — how this program relates to every existing mechanical gate it depends on.
13. `schemas/` — the three concrete JSON Schemas (`dispatch_packet_v1`, `autonomy_execution_state_v1`,
    `audit_event_v1`) referenced throughout the above.

## Document index

| Document | Deliverable |
|---|---|
| `STATE_MACHINE.md` | 1 — canonical state machine |
| `AUTHORITY_MATRIX.md` | 2 — authority matrix |
| `schemas/dispatch_packet_v1.schema.json` | 3 — dispatch packet schema |
| `schemas/autonomy_execution_state_v1.schema.json` | 4 — execution-state schema |
| `schemas/audit_event_v1.schema.json` | 5 — audit-event schema |
| `KILL_SWITCH_CONTRACT.md` | 6 — kill-switch contract |
| `MODE_CONTRACT.md` | 7 — mode contract |
| `LIMITS.md` | 8 — hard limits |
| `CRASH_RESTART_SEMANTICS.md` | 9 — crash/restart semantics |
| `T1_QUEUE_BEHAVIOR.md` | 10 — T1 non-blocking guarantee |
| `THREAT_MODEL.md` | 11 — threat model |
| `NOTIFICATION_TAXONOMY.md` | 12 — notification taxonomy |
| `PROMOTION_ROLLBACK_STANDARDS.md` | 13 — promotion/rollback standards |
| `PROGRAM_COMPLETION_DEFINITION.md` | 14 — program completion definition |
| `COMPATIBILITY_MAP.md` | 15 — compatibility map |

## What this is not

- Not an implementation. No `scripts/autonomy/**` code exists as part of this lane.
- Not a grant of new authority. Every contract here is bounded by, never looser than, the existing
  `DELEGATION_POLICY.md` and `merge-gate.yml` — see `AUTHORITY_MATRIX.md` §4.
- Not a T1 system. There is no mode, no schema value, no code path in this contract set that grants T1,
  production, or credential authority to any actor governed by it, ever.
