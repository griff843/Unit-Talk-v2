# Program 5 Activation Scope Declaration

**Status:** DRAFT — DISPATCH HOLD  
**Produced:** 2026-06-01  
**Authority:** PM (griffadavi)  
**Governing issues:** UTV2-1144–1154  
**Activation gates:**
  - P1 certified: YES (2026-05-30)
  - P2 certified: BLOCKED — see PROGRAM_2_CERTIFICATION.md
  - P3 certified: BLOCKED — see PROGRAM_3_CERTIFICATION.md
  - P4 certified: YES (2026-06-01, HEAD 55bd0bd7)
  - M10 Path A PM decision: BLOCKED — see decisions/M10_PATH_A_DECISION.md

**Dispatch state:** HOLD — do not open any Program 5 lane until activation gates are satisfied.

---

## 1. Program Name and Purpose

**Program 5: Capital Integrity and System Burn-In**

Program 5 implements the constitutional capital-layer guarantees and system burn-in. It is the
final program in the constitutional sequence before the system can claim production readiness
under the autonomous pick lifecycle.

Program 5 has four sub-programs, each with independent activation gates:

| Sub-Program | Label | Issues | Activation Gate |
|---|---|---|---|
| P5-A | Adversarial Capital Runtime | UTV2-1147–1149 | P1–P4 certified |
| P5-B | Burn-In Orchestration | UTV2-1150–1151 | P1+P2 certified |
| P5-C | Treasury Runtime | UTV2-1144–1146 | P1–P4 certified + M10 Path A |
| P5-D | Capital Scaling Runtime | UTV2-1152–1154 | 1151 + 1146 certified |

P5-A is the only sub-program that can dispatch immediately once P1–P4 are certified.
P5-B requires P2 cert. P5-C requires M10 Path A. P5-D requires both P5-B and P5-C complete.

---

## 2. Complete Issue Inventory

### P5-A — Adversarial Capital Runtime (INIT-5.2.x)
**Activation gate:** P1–P4 certified — SATISFIED once P3 cert resolves

| Issue | INIT | Title | Tier | Domain | Dependency | Executor |
|---|---|---|---|---|---|---|
| UTV2-1147 | 5.2.1 | Independent Data Path | T1 | domain | P1–P4 certified | Codex |
| UTV2-1148 | 5.2.2 | Manipulation and Provider-Anomaly Detectors | T1 | domain | 1147 certified | Codex |
| UTV2-1149 | 5.2.3 | First-Class Escalation Wiring | T1 | domain | 1148 certified | Codex |

**Sequential chain:** 1147 → 1148 → 1149. No parallelism within this sub-program.

### P5-B — Burn-In Orchestration (INIT-5.3.x)
**Activation gate:** P1+P2 certified — BLOCKED on P2 cert

| Issue | INIT | Title | Tier | Domain | Dependency | Executor |
|---|---|---|---|---|---|---|
| UTV2-1150 | 5.3.1 | Burn-In Orchestration and Monitoring Harness | T1 | ops/infra | P1+P2 certified | Codex |
| UTV2-1151 | 5.3.2 | 30-Day Burn-In Execution | T1 | ops | 1150 certified | Ops/Claude |

**Sequential chain:** 1150 → 1151.

UTV2-1151 (30-Day Burn-In Execution) is a time-gated operational execution, not a standard
implementation lane. It requires: (a) all P5-A adversarial detectors operational, (b) burn-in
harness from 1150 deployed, (c) PM decision on burn-in entry conditions.

### P5-C — Treasury Runtime (INIT-5.1.x)
**Activation gate:** P1–P4 certified + M10 Path A PM decision — BLOCKED on M10 Path A

| Issue | INIT | Title | Tier | Domain | Dependency | Executor |
|---|---|---|---|---|---|---|
| UTV2-1144 | 5.1.1 | Immutable Capital Ledger | T1 | db/domain | M10 Path A decision | Codex |
| UTV2-1145 | 5.1.2 | Reserve Tracking and Capital-Level Drawdown | T1 | domain | 1144 certified | Codex |
| UTV2-1146 | 5.1.3 | Dual-Authorized Treasury Operations | T1 | domain | 1145 certified | Codex |

**Sequential chain:** 1144 → 1145 → 1146. No parallelism within this sub-program.
UTV2-1144 is a schema-level change (Immutable Capital Ledger). Requires `pnpm supabase:types`
regeneration and `pnpm test:db` as part of T1 proof.

### P5-D — Capital Scaling Runtime (INIT-5.4.x)
**Activation gate:** UTV2-1151 certified + UTV2-1146 certified — BLOCKED on both P5-B and P5-C

| Issue | INIT | Title | Tier | Domain | Dependency | Executor |
|---|---|---|---|---|---|---|
| UTV2-1152 | 5.4.1 | Scaling Authorization Runtime | T1 | domain | 1151 + 1146 certified | Codex |
| UTV2-1153 | 5.4.2 | Edge-Persistence, Liquidity, and Survivability Gates | T1 | domain | 1152 certified | Codex |
| UTV2-1154 | 5.4.3 | Simulation Runtime Integration | T1 | domain | 1153 certified | Codex |

**Sequential chain:** 1152 → 1153 → 1154.

---

## 3. Entry Criteria

All of the following must be true before any Program 5 lane opens:

| Criterion | Gate | Current State |
|---|---|---|
| Clean working tree | 0 uncommitted files | PASS |
| P1 certified | PM cert declaration in CERT_BOARD | PASS (2026-05-30) |
| P2 certified | PM cert declaration in PROGRAM_2_CERTIFICATION.md | **BLOCKED** |
| P3 certified | PM cert declaration in PROGRAM_3_CERTIFICATION.md | **BLOCKED** |
| P4 certified | 12/12 TC PASS, HEAD 55bd0bd7 | PASS (2026-06-01) |
| M10 Path A decision | Decision doc in decisions/M10_PATH_A_DECISION.md | **BLOCKED** |
| No active lanes | `active_lanes: []` in execution-state | PASS |
| Merge mutex released | `status: released` | PASS |
| cert-check P1 PASS | `pnpm ops:cert-check` exit 0 | PASS (env-gated) |
| No frozen-domain violation | Domain package pure — no I/O, DB, HTTP | Must verify before each dispatch |

**Exception for P5-A:** UTV2-1147 can open immediately once P1–P4 all certified (M10 Path A
is only required for P5-C Treasury lanes). P5-A has no M10 dependency.

---

## 4. Exit Criteria

Program 5 is certified when ALL of the following are mechanically verified:

- [ ] UTV2-1147 certified (pass TC, SHA-bound proof)
- [ ] UTV2-1148 certified
- [ ] UTV2-1149 certified (Adversarial Capital Runtime complete)
- [ ] UTV2-1150 certified
- [ ] UTV2-1151 certified (30-Day Burn-In complete — time-gated)
- [ ] UTV2-1144 certified (Immutable Capital Ledger — requires M10 Path A)
- [ ] UTV2-1145 certified
- [ ] UTV2-1146 certified (Treasury Runtime complete)
- [ ] UTV2-1152 certified
- [ ] UTV2-1153 certified
- [ ] UTV2-1154 certified (Capital Scaling Runtime complete)
- [ ] PM Program 5 certification declaration issued
- [ ] CERT_BOARD.md updated with P5 effect section

---

## 5. Frozen-Domain Unlock Gates

| Gate | Issues Unlocked | Unlock Condition |
|---|---|---|
| P1–P4 certified | UTV2-1147 (P5-A Wave 1) | P1, P3, P4 certs + current P4 done |
| P2 certified | UTV2-1150 (P5-B Wave 1) | P2 cert declaration issued |
| M10 Path A decision | UTV2-1144 (P5-C Wave 1) | PM decision doc created |
| UTV2-1147 certified | UTV2-1148 | Auto-unlock on TC pass |
| UTV2-1148 certified | UTV2-1149 | Auto-unlock on TC pass |
| P1+P2 certified + 1150 certified | UTV2-1151 | Sequential |
| M10 Path A + 1144 certified | UTV2-1145 | Sequential |
| 1145 certified | UTV2-1146 | Sequential |
| 1151 + 1146 certified | UTV2-1152 | Convergence gate |
| 1152 certified | UTV2-1153 | Sequential |
| 1153 certified | UTV2-1154 | Sequential |

---

## 6. Proof Requirements

All Program 5 lanes are T1. Proof requirements per lane:

| Requirement | All P5 lanes |
|---|---|
| `pnpm verify` PASS on branch | Required |
| `pnpm type-check` PASS | Required |
| `pnpm test` PASS | Required |
| `pnpm test:db` PASS | Required (T1 — all P5 lanes) |
| Truth-check exit 0 | Required via `pnpm ops:truth-check UTV2-###` |
| Evidence bundle v1 | Required — SHA-tied to merge SHA (not branch HEAD) |
| `verification.md` with `## Verification` header | Required |
| Proof in `docs/06_status/proof/UTV2-###/` | Required |
| `pnpm supabase:types` regenerated | Required for any DB schema changes (at minimum UTV2-1144) |
| PM `t1-approved` GitHub label | Required before merge — all P5 lanes |
| Frozen-domain audit | Required for P5-C (Treasury): explicit PM sign-off that mutation does not touch certified P1–P4 artifacts |
| M10 Path A reference | Required in proof for any P5-C (Treasury) lane |

---

## 7. Lane Sequence and Dependency Order

```
[P1 cert ✅] [P4 cert ✅] [P3 cert ⏳] [P2 cert ⏳] [M10 Path A ⏳]
      │              │              │             │             │
      └──────┬───────┘              │             │             │
             │                      │             │             │
      P3 cert resolves ─────────────┘             │             │
             │                                    │             │
             ▼                                    │             │
        UTV2-1147 (P5-A Wave 1)                  │             │
             │                                    │             │
             ▼                                    ▼             │
        UTV2-1148                    P2 cert ─► UTV2-1150       │
             │                                    │             │
             ▼                                    ▼             │
        UTV2-1149                           UTV2-1151           │
             │                                    │             │
             └──────────────┬─────────────────────┘             │
                            │                                   │
                            │           M10 Path A ─────────────┘
                            │                │
                            │                ▼
                            │          UTV2-1144
                            │                │
                            │                ▼
                            │          UTV2-1145
                            │                │
                            │                ▼
                            │          UTV2-1146
                            │                │
                            └────────┬───────┘
                                     │ (both 1151 + 1146 certified)
                                     ▼
                                UTV2-1152
                                     │
                                     ▼
                                UTV2-1153
                                     │
                                     ▼
                                UTV2-1154
```

---

## 8. Dispatch Plan (First Wave)

**Wave 0 (pre-dispatch — required before any lane opens):**
1. Resolve P2 certification (B2-1 through B2-5 in PROGRAM_2_CERTIFICATION.md)
2. Resolve P3 certification (B3-1 through B3-8 in PROGRAM_3_CERTIFICATION.md)
3. PM issues M10 Path A decision (or explicitly defers Treasury lanes)
4. `pnpm ops:execution-state --json` confirms active_lanes:[], merge_mutex:released

**Wave 1 (first dispatch after gates satisfied):**
- Open UTV2-1147 (INIT-5.2.1 — Independent Data Path)
- Executor: Codex
- Tier: T1
- Blocked by: Nothing (P1–P4 cert = activation gate)
- Singleton: No
- Parallel with: UTV2-1150 (P5-B — if P2 cert is also resolved simultaneously)
- Max lanes open simultaneously: 2 (Claude 2, Codex 4 — stay within cap)

**Wave 2 (after 1147 certified):**
- Open UTV2-1148 (INIT-5.2.2 — Manipulation and Provider-Anomaly Detectors)
- Executor: Codex, T1
- Parallel with: UTV2-1150 or UTV2-1144 (if M10 Path A resolved)

**Wave 3+ :** Sequential per dependency map above.

---

## 9. Max Concurrency

Per CERT_BOARD.md: **6 lanes total — Claude: 2, Codex: 4, merge serialized.**

UTV2-1176 (7-lane expansion) remains FROZEN. Do not increase concurrency.

P5-A, P5-B, P5-C can run in parallel with each other (they are domain-independent)
subject to the concurrency cap. P5-D requires both P5-B and P5-C complete — it is strictly
sequential after convergence.

---

## 10. Claude vs Codex Assignment

| Issue | Executor | Rationale |
|---|---|---|
| UTV2-1147 | Codex | Implementation: domain module, pure functions, well-scoped |
| UTV2-1148 | Codex | Implementation: detection algorithms, domain/analytics |
| UTV2-1149 | Codex | Implementation: escalation wiring, outbox integration |
| UTV2-1150 | Codex | Implementation: orchestration harness, monitoring infra |
| UTV2-1151 | Claude + Ops | Execution/verification: burn-in is an ops event, not a code change; Claude produces daily checklist evidence |
| UTV2-1144 | Codex | Implementation: schema migration + domain entity |
| UTV2-1145 | Codex | Implementation: reserve tracking domain module |
| UTV2-1146 | Codex | Implementation: dual-auth treasury operations |
| UTV2-1152 | Codex | Implementation: scaling authorization runtime |
| UTV2-1153 | Codex | Implementation: edge-persistence, liquidity gates |
| UTV2-1154 | Codex | Implementation: simulation runtime |

Claude owns: governance standards, acceptance review of P5-C Treasury contracts (capital
domain is constitutionally sensitive — Claude must co-author the standard before Codex
implements), final readiness verdict framing.

---

## 11. Gate Contract for Every P5 Lane

| Gate | Requirement |
|---|---|
| `pnpm verify` | Green on branch |
| `pnpm type-check` | PASS |
| `pnpm test` | PASS |
| `pnpm test:db` | PASS (required for all T1) |
| Truth-check | `pnpm ops:truth-check UTV2-###` exit 0 |
| Proof packet | SHA-tied to merge SHA; evidence bundle v1; verification.md with `## Verification` header |
| Tier label | T1 set in Linear and on PR |
| `t1-approved` label | Required on GitHub PR before merge |
| Clean git status | 0 uncommitted files at TC time |
| R-level compliance | r1-r5-rules.json lookup before lane close |
| Supabase types | `pnpm supabase:types` on any migration lane (minimum UTV2-1144) |
| Frozen-domain audit | P5-C Treasury lanes: PM written sign-off that DB mutations do not touch P1–P4 certified artifacts |
| M10 Path A reference | Required in proof for all UTV2-1144, 1145, 1146 |

---

## 12. Hold / Kill Conditions

**Pre-dispatch hard blocks (cannot be waived):**
- P2 or P3 cert not issued — HOLD
- M10 Path A not decided — HOLD on P5-C lanes only (P5-A and P5-B can proceed without it)
- Active lanes at dispatch time — HOLD
- Working tree not clean — HOLD

**In-flight kill conditions:**
- Any P5 lane TC exit code ≠ 0 → lane reopens, no Done
- `pnpm test:db` fail on any T1 lane → lane reopens
- Merge mutex violation → escalate to PM
- Any P5-C (Treasury) lane mutates a P1-certified artifact without PM written sign-off → KILL lane immediately
- 30-Day Burn-In (UTV2-1151) entry condition check fails → PM hold, investigate before continuing
