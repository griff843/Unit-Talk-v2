# Stage 2 Activation Checklist — WS-1.2 / WS-1.3

> **SUPERSEDED / HISTORICAL — This document is retained for audit history only. Current state lives in docs/06_status/CURRENT_STATE.md.**

**Generated:** 2026-05-24  
**Status:** Pre-activation — WS-1.3 immediately activatable; WS-1.2 activates on UTV2-1087 close  
**Authority:** PM  

---

## Activation Triggers

| Workstream | Trigger | Status |
|---|---|---|
| WS-1.3 — Runtime Invariant Enforcement | UTV2-1088 (INIT-1.3.1) certified | **ALREADY MET — activate now** |
| WS-1.2 — Canonical Replay Infrastructure | UTV2-1087 (INIT-1.1.4) certified | Pending — 1087 in-flight |

---

## WS-1.3 — Runtime Invariant Enforcement

**Activatable immediately.** Blocker UTV2-1088 (INIT-1.3.1 — Machine-Readable Invariant Registry) is done/merged.

| Issue | INIT | Title | Tier | Blocker | Ready? |
|---|---|---|---|---|---|
| UTV2-1089 | 1.3.2 | Invariant Engine | t0 | UTV2-1088 (DONE) | **YES — start now** |
| UTV2-1090 | 1.3.3 | Automatic Quarantine and Escalation | t1 | UTV2-1089 | After 1089 certified |
| UTV2-1094 | 1.3.4 | Production/Replay Integration; False-Confidence Test Retirement (stage-gate) | t1 | UTV2-1090 + UTV2-1093 | After both complete |

---

## WS-1.2 — Canonical Replay Infrastructure

**Activates when UTV2-1087 (INIT-1.1.4) closes.** First lane opens immediately on 1087 certification.

| Issue | INIT | Title | Tier | Blocker | Ready? |
|---|---|---|---|---|---|
| UTV2-1091 | 1.2.1 | Isolated Full-Pipeline Replay Harness | t0 | UTV2-1087 (in-flight) | After 1087 certified |
| UTV2-1092 | 1.2.3 | Replay Divergence Engine | t1 | UTV2-1091 | After 1091 certified |
| UTV2-1093 | 1.2.2 | Replay Validator Un-Stubbing | t1 | UTV2-1091 + UTV2-1089 | After both certified |
| UTV2-1095 | 1.2.4 | 30-Day Replay Driver and Latent-Divergence Remediation (existential) | t1 | UTV2-1092 + UTV2-1093 | After both certified |

---

## Cross-Workstream Dependency Map

```
UTV2-1087 (in-flight)         UTV2-1088 (DONE)
     │                              │
     ▼                              ▼
UTV2-1091 (WS-1.2 t0)       UTV2-1089 (WS-1.3 t0) ← ready NOW
     │                    ╱         │
     │                  ╱           ▼
     ▼     ╲           ╱       UTV2-1090 (WS-1.3 t1)
UTV2-1092   ╲         ╱            │
     │        ╲       ╱            │
     │     UTV2-1093 ◄─────────────┘
     │       (convergence point: requires both 1091 and 1089)
     │              │
     └──────────────┘
            │
            ▼
        UTV2-1095           UTV2-1094 (stage-gate)
     (WS-1.2 existential)   (requires 1093 + 1090)
```

**WS-1.2 and WS-1.3 are not fully independent.** UTV2-1093 (INIT-1.2.2 — Replay Validator Un-Stubbing) requires both UTV2-1091 (WS-1.2 t0) and UTV2-1089 (WS-1.3 t0). The workstreams must progress concurrently and converge at UTV2-1093. Stage 2 cannot complete unless both tracks advance.

UTV2-1094 (INIT-1.3.4) is the existential stage-gate: it blocks Stage 3. It requires UTV2-1090 and UTV2-1093 — meaning full convergence of both workstreams.

---

## Parallelization Recommendation

**Grant immediate parallel execution on both workstreams.**

- Open a lane on **UTV2-1089 now** (WS-1.3 — all blockers resolved).
- Open a lane on **UTV2-1091 immediately when UTV2-1087 certifies** (do not delay).
- Run both workstreams concurrently — they must converge at UTV2-1093.
- Do NOT serialize WS-1.2 after WS-1.3 or vice versa. UTV2-1093 is blocked by both t0 issues; sequential execution doubles the critical path.

**Lane capacity required:** 2 active constitutional lanes simultaneously during Stage 2 peak. Current limit is 2 Claude lanes — this is within budget.

---

## Pre-Activation Gates (verify before opening any Stage 2 lane)

### Universal (all Stage 2 issues)
- [ ] Preflight token valid at lane start
- [ ] Tier label (T1) set on issue before marking Ready (all Stage 2 issues are T1)
- [ ] `blocked:internal` removed from the issue being activated at lane open time
- [ ] No more than 2 active constitutional lanes simultaneously
- [ ] `pnpm verify` green on the branch before PR open

### WS-1.3 — UTV2-1089 (ready now)
- [x] UTV2-1088 (INIT-1.3.1) merge SHA confirmed — **ALREADY MET**
- [ ] `blocked:internal` removed from UTV2-1089 — **applied 2026-05-24**
- [ ] Priority set to Urgent — **applied 2026-05-24**
- [ ] `pnpm ops:truth-check UTV2-1088` exits 0 (verify before opening 1089 lane)

### WS-1.2 — UTV2-1091 (activates on 1087 close)
- [ ] UTV2-1087 (INIT-1.1.4) merge SHA confirmed in evidence bundle
- [ ] `pnpm ops:truth-check UTV2-1087` exits 0
- [ ] Priority set to Urgent — **applied 2026-05-24**
- [ ] `blocked:internal` removed from UTV2-1091 at lane open time

---

## Label Corrections Applied (2026-05-24)

| Issue | Change | Rationale |
|---|---|---|
| UTV2-1089 | `blocked:internal` removed | Blocker UTV2-1088 is done/merged — label was stale |
| UTV2-1091 | Priority → Urgent | First in WS-1.2 sequence; must be dispatched immediately on 1087 close |
| UTV2-1089 | Priority → Urgent | First in WS-1.3 sequence; ready now |

---

## Stage 2 Certification Gate

Stage 2 does not close until all of the following are done:

1. UTV2-1094 (INIT-1.3.4) certified — Production/Replay Integration complete, false-confidence tests retired
2. UTV2-1095 (INIT-1.2.4) certified — 30-day replay driver clean (zero divergence, zero production writes)
3. Runtime Certification proof bundle assembled and PM-approved
4. Replay Certification proof bundle assembled and PM-approved
5. `pnpm ops:truth-check` passes on both certification issues
6. Stage 3 first lane (UTV2-1104 — GovernanceException Entity) unblocked

---

## Recommended Immediate PM Actions

1. **Open a lane on UTV2-1089 now.** WS-1.3 t0 is clear. No gates remain. Do not wait for 1087.
2. **When UTV2-1087 closes: immediately open UTV2-1091.** The replay track must start as soon as the harness is sound.
3. **Do not serialize.** Both t0 issues running concurrently is the correct execution model. UTV2-1093 is the synchronization point — it cannot start until both t0s are certified.
4. **Watch for UTV2-1094 (stage-gate).** This is the existential blocker for Stage 3. Any slip here delays the entire constitutional convergence sequence.
