# Board Convergence Report — PM Execution Runtime Audit

**Generated:** 2026-05-24  
**Operation:** Board Convergence Cleanup — 8-task PM/runtime organization pass  
**Authority:** PM-authorized board mutation session  
**Status:** Tasks 1–4 complete; Tasks 5–8 documented here

---

## Task 4 — Parallel-Safe Activation Decisions

### UTV2-1071 — Five-Lane End-to-End Validation Run

**Decision: ACTIVATED**

All 7 hardening prerequisites are Done:

| Blocker | Title | Status |
|---|---|---|
| UTV2-1064 | Executor/work-class compatibility cleanup | Done 2026-05-21 |
| UTV2-1065 | Codex receive/link idempotency | Done 2026-05-19 |
| UTV2-1066 | Deterministic merge-SHA recording | Done 2026-05-19 |
| UTV2-1067 | T2 ops proof bundle generation | Done 2026-05-19 |
| UTV2-1068 | Idempotent/self-locking lane close | Done 2026-05-19 |
| UTV2-1069 | Actionable reconcile modes | Done 2026-05-19 |
| UTV2-1070 | Per-lane pnpm state isolation | Done 2026-05-21 |

**Changes applied:** Status PM Triage → Backlog; priority Medium → High.

This is a T2, parallel-safe, Class F (Governance Runtime) issue. It does not touch constitutional lanes. Dispatch it alongside or after UTV2-1089. The five-lane validation proves the hardened orchestration kernel end-to-end — a critical proof-of-completeness for the Orchestration Kernel v1 project.

### UTV2-884 — Discord Member DM Routing

**Decision: DEFER — Needs Standard correct**

The "Needs Standard" state is accurate. The implementation spec does not exist. The DM injury use case has a declared dependency on UTV2-878 (injury notification service). No action taken. Activate when M2 technical spec is authored.

### UTV2-885 — Discord Game-Thread Routing

**Decision: DEFER — Needs Standard correct**

Same status. Lower priority than UTV2-884. "Needs Standard" correct. No action taken.

---

## Task 5 — Execution Runtime View Plan

Recommended Linear saved filters for the execution runtime. Create these as team-level saved views.

### View 1: Active Constitutional (daily driver)
**Filter:** `label:constitutional AND NOT label:state:dormant`  
**Purpose:** See all constitutional issues that are not dormant — the active and stage-ready set.  
**Sort:** Priority (Urgent first), then label tier (t0 before t1)

### View 2: Stage 2 Queue (activation planning)
**Filter:** `label:state:stage2-ready`  
**Purpose:** The 7 issues that activate on WS-1.1 certification. Should show 2 Urgent (UTV2-1089, UTV2-1091) and 5 High.  
**Sort:** By tier label (t0 first)

### View 3: Dispatch Now (safe-class backlog)
**Filter:** `status:Backlog AND NOT label:state:dormant AND NOT label:constitutional AND NOT label:blocked:internal AND NOT label:blocked:external`  
**Purpose:** Issues ready for immediate dispatch. Currently includes UTV2-1071 (five-lane validation) and other non-constitutional Backlog issues.  
**Sort:** Priority

### View 4: Data-Gated (analytics backlog)
**Filter:** `label:state:data-gated`  
**Purpose:** The 3 analytics issues waiting on live pick volume. Check monthly — activate when pick thresholds (50+, 200+) are met.  
**Current issues:** UTV2-1032, UTV2-1033, UTV2-1042

### View 5: Needs Spec (M2 feature debt)
**Filter:** `status:Needs Standard`  
**Purpose:** Track features blocked on technical spec authoring. Currently includes UTV2-884, UTV2-885.  
**Action:** Spec authoring is a Claude lane activity — add to queue when M2 is prioritized.

### View 6: PM Triage (unclassified)
**Filter:** `status:PM Triage`  
**Purpose:** Catch net for issues that need PM disposition. Should be nearly empty after this cleanup.  
**Current:** UTV2-1071 has been moved out. Review any remaining items for archival or reclassification.

### Label hygiene recommendation

| Label | Current count (approx.) | Action |
|---|---|---|
| `state:dormant` | 59 | Correct — do not dispatch these |
| `state:stage2-ready` | 7 | Correct — 2 Urgent ready to start |
| `state:data-gated` | 3 | Correct — review at pick volume thresholds |
| `needs:hetzner` | 11 (all Done) | Semantically retired — label on closed issues only |
| `blocked:internal` | 6 (Stage 2 issues minus 1089) | Correct use — named in-flight blocker (UTV2-1087) |
| `blocked:external` | several Done issues | Semantically retired on closed issues |

---

## Task 6 — Throughput Optimization Report

### Current dispatch state (2026-05-24)

| Executor | Active | Capacity | Utilization |
|---|---|---|---|
| Claude | 1 (UTV2-1087) | 2 | 50% |
| Codex | 0 | 4 | 0% |

**Throughput gap:** 1 idle Claude slot + 4 idle Codex slots. Board has executable work available.

### Immediately dispatchable

| Issue | Type | Executor | Notes |
|---|---|---|---|
| UTV2-1089 | WS-1.3 t0, T1 | Claude | All blockers resolved — ready now |
| UTV2-1071 | Orchestration validation, T2 | Claude or Codex | All 7 prerequisites done |

### On UTV2-1087 close

| Issue | Type | Executor | Trigger |
|---|---|---|---|
| UTV2-1091 | WS-1.2 t0, T1 | Claude or Codex | UTV2-1087 certified |

### Stage 2 parallel throughput model

Once both UTV2-1087 and UTV2-1089 close:
- UTV2-1091 (WS-1.2) + UTV2-1090 (WS-1.3) can run simultaneously → 2 constitutional Claude lanes
- UTV2-1092 (WS-1.2) and UTV2-1093 (WS-1.3 × WS-1.2 convergence) require 1091 + 1089 both certified
- UTV2-1093 is the synchronization point — it cannot start until both t0 lanes are done
- Critical path: 1087 → 1091 → 1093 → 1094 (stage-gate); WS-1.3 is on the parallel track but converges at 1093

**Minimum critical path to Stage 2 certification:**  
`1087 → 1091 → (1092 ∥ 1093[needs 1089]) → 1095 ∥ 1094[needs 1093+1090]`

Stage 2 gate closes when UTV2-1094 and UTV2-1095 are both certified.

### Bottleneck analysis

| Bottleneck | Impact | Mitigation |
|---|---|---|
| UTV2-1087 not yet merged | Blocks entire WS-1.2 track | None — it's in-lane, active |
| UTV2-1093 dual-dependency | Cannot start until 1091 + 1089 both done | Run both tracks concurrently; do not serialize |
| T1 proof review cycle | PM review on every constitutional certification | PM must be staged for proof review on 1087 close |
| 2-Claude-lane limit | Constitutional work cannot saturate the Codex track | Use Codex slots for UTV2-1071 + tooling during constitutional work |

### Recommendation: immediate throughput actions

1. Open UTV2-1089 lane now (Claude slot 2).
2. Dispatch UTV2-1071 to Codex (T2 validation, no constitutional overlap).
3. On UTV2-1087 close: immediately open UTV2-1091 (do not wait for proof review to start the next lane — they can overlap).
4. Do not fill Codex slots with constitutional work — keep them for T2/T3 parallel-safe lanes.

---

## Task 7 — Governance Hygiene Audit

### `needs:hetzner` — RETIRED (11 issues, all Done)

All 11 `needs:hetzner` issues are Done. The label is semantically complete. No open issues carry it. No cleanup needed on open issues. The label itself can be kept for historical filtering or archived.

**Verdict:** No action needed. Label retired by completion.

### `blocked:internal` — STATUS CORRECT after this cleanup

After this operation:
- 59 dormant issues: `blocked:internal` removed — correct (stage-gate dependency encoded in `blocks:stage{N}` labels, not a named blocker)
- 6 Stage 2 issues (UTV2-1090, 1091, 1092, 1093, 1094, 1095): `blocked:internal` retained — correct (named in-flight blocker: UTV2-1087)
- UTV2-1089: `blocked:internal` removed — correct (blocker UTV2-1088 was already Done)

**Verdict:** Label is now meaningful. Only on issues with a concrete, named, in-flight blocker.

### PM Triage — CLEARED

UTV2-1071 was the only actionable PM Triage item from the constitutional/orchestration domain. It has been moved to Backlog. Any remaining PM Triage items are outside the scope of this cleanup and require individual PM review.

### Needs Standard — CORRECT

UTV2-884 and UTV2-885 are correctly in Needs Standard. No spec exists for either. The "Needs Standard" state is the right holding state for feature work that lacks implementation specifications.

### PROGRAM_STATUS.md — STALE (requires PM update)

The `docs/06_status/PROGRAM_STATUS.md` file was last updated 2026-05-20 and shows the following as "In Progress" — but Linear shows all are Done:

| Issue | PROGRAM_STATUS.md claim | Linear truth |
|---|---|---|
| UTV2-1014 | In Progress — .env.production delivery fix | Done 2026-05-20 |
| UTV2-1015 | In Progress — Loki deploy | Done 2026-05-20 |
| UTV2-1016 | In Progress — Uptime Kuma setup | Done 2026-05-20 |
| UTV2-1031 | In Progress — Live rollback drill | Done 2026-05-21 |
| UTV2-1041 | In Progress — 72h burn-in blocked | Done 2026-05-20 |
| UTV2-1012 | In Progress — Supervisor verification | Done 2026-05-20 |
| UTV2-1013 | Done (recorded) | Done — consistent |

**PROGRAM_STATUS.md Readiness Gates section also shows:**
- Ingestor freshness: Red → verify against UTV2-1087 current status
- Centralized logging: Red → Linear says UTV2-1015 Done (verify runtime truth)
- Monitoring completeness: Amber → Linear says UTV2-1016 Done
- Rollback drill: Red → Linear says UTV2-1031 Done
- 72h burn-in: Not Started → Linear says UTV2-1041 Done

**Warning:** Linear "Done" status does not automatically mean runtime truth is proven. Before updating PROGRAM_STATUS.md readiness gates from Red to Green, verify against proof bundles and runtime evidence — not just Linear state. The 72h burn-in in particular requires independent verification that continuous runtime evidence was captured (not just that the issue was closed).

**Recommended PM action:** PM to verify proof bundles for UTV2-1014, 1015, 1016, 1031, 1041 and update PROGRAM_STATUS.md readiness gates to reflect verified truth.

### Stale lane references — None active

No open lane manifests reference retired infrastructure lanes. Active lane (UTV2-1087) has current manifest.

---

## Task 8 — Full Deliverables Summary

### What was done in this operation

**Labels created (3 new):**

| Label | Color | Purpose |
|---|---|---|
| `state:dormant` | #6B7280 (gray) | Constitutional blueprints in Stages 3–6 — do not dispatch |
| `state:stage2-ready` | #2563EB (blue) | Constitutional issues that activate on WS-1.1 certification |
| `state:data-gated` | #EAB308 (yellow) | Analytics issues blocked on live pick volume thresholds |

**Issues mutated (69 total):**

| Category | Count | Change |
|---|---|---|
| Dormant constitutional (Stages 3–6) | 59 | `blocked:internal` removed, `state:dormant` added |
| Stage 2 ready (WS-1.2, WS-1.3) | 7 | `state:stage2-ready` added; `blocked:internal` retained (except 1089) |
| Data-gated (analytics) | 3 | `state:data-gated` added |

**Priority corrections:**

| Issue | From | To | Reason |
|---|---|---|---|
| UTV2-1089 | No priority | Urgent | WS-1.3 t0; ready now |
| UTV2-1091 | No priority | Urgent | WS-1.2 t0; first on 1087 close |
| UTV2-1071 | Medium | High | All 7 blockers done; orchestration validation ready |

**State corrections:**

| Issue | From | To | Reason |
|---|---|---|---|
| UTV2-1071 | PM Triage | Backlog | All 7 hardening prerequisites complete |
| UTV2-1089 | (blocked:internal) | (removed) | Blocker UTV2-1088 was Done; label was stale |

**Documents created:**
- `docs/06_status/STAGE2_ACTIVATION_CHECKLIST.md` — Stage 2 dependency map, parallelization recommendation, pre-activation gates
- `docs/06_status/BOARD_CONVERGENCE_REPORT.md` — this document

---

### What was NOT changed (hard constraints honored)

- UTV2-1087 — not touched
- Constitutional sequencing — not modified
- Programs 3–5 issues — only `state:dormant` added; no activation changes
- WS-1.2/1.3 dependency graph — preserved exactly as encoded in relations
- Constitutional stage-gate architecture — untouched

---

### Recommended next PM actions

**Immediate (today):**

1. **Open a lane on UTV2-1089** (WS-1.3 — Invariant Engine). All blockers resolved. Priority Urgent. T1. Parallel with UTV2-1087.
2. **Dispatch UTV2-1071 to Codex**. Five-lane orchestration kernel validation. T2. All 7 blockers done. Parallel-safe.

**On UTV2-1087 certification:**

3. **Immediately open UTV2-1091** (WS-1.2 — Isolated Full-Pipeline Replay Harness). Do not delay; it's Urgent.
4. Continue UTV2-1089 → UTV2-1090 in parallel on the WS-1.3 track.
5. UTV2-1093 (Replay Validator Un-Stubbing) becomes activatable once both UTV2-1091 and UTV2-1089 are certified.

**PM verification needed:**

6. **Verify proof bundles for UTV2-1014, 1015, 1016, 1031, 1041** — Linear shows Done but PROGRAM_STATUS.md readiness gates still show Red/Amber. Do not update the readiness gates until runtime evidence is verified.
7. **Update PROGRAM_STATUS.md** after verification — current document is materially stale (last updated 2026-05-20).

**Spec authoring (M2 backlog):**

8. When M2 is prioritized, author technical specs for UTV2-884 and UTV2-885 before activating those lanes. Both are in Needs Standard; both need specs before implementation.

---

### Recommended next dispatches (ordered)

| Priority | Issue | Title | Type | Executor | Ready? |
|---:|---|---|---|---|---|
| 1 | UTV2-1089 | INIT-1.3.2 — Invariant Engine | Constitutional T1 | Claude | NOW |
| 2 | UTV2-1071 | Five-Lane Orchestration Validation | T2 validation | Codex | NOW |
| 3 | UTV2-1091 | INIT-1.2.1 — Full-Pipeline Replay Harness | Constitutional T1 | Claude | On 1087 close |
| 4 | UTV2-1090 | INIT-1.3.3 — Auto Quarantine | Constitutional T1 | Claude | After 1089 |
| 5 | UTV2-1092 | INIT-1.2.3 — Replay Divergence Engine | Constitutional T1 | Claude/Codex | After 1091 |
| 6 | UTV2-1093 | INIT-1.2.2 — Replay Validator Un-Stubbing | Constitutional T1 | Claude | After 1091 + 1089 |

---

### Archival candidates

No issues identified for archival in this pass. The 59 dormant issues are correctly labeled `state:dormant` — they are blueprints for future stages, not deprecated work. They should not be archived until their containing stage is formally superseded or cancelled.

UTV2-884 and UTV2-885 are M2 feature work with valid acceptance criteria. Not archival candidates.
