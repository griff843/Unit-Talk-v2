# Pipeline Finalization — Terminal Proof Criteria

> **Adopted:** 2026-06-28 by lane UTV2-1339  
> **Authority:** This document defines the terminal verdict criteria for milestones M1 through M5 in the "Pipeline Finalization — PARTIAL to PROVEN" project.  
> **Purpose:** Prevent historical evidence from inflating progress. Every lane that claims to advance a milestone verdict must cite which criterion changes and from what starting state to what ending state.

---

## How to Read This Document

Each milestone has exactly three verdict states:

| Verdict | Meaning |
|---------|---------|
| **PASS** | All acceptance criteria for this milestone are met with *current* evidence. Historical data that predates the evidence epoch does not count. |
| **PARTIAL** | Some acceptance criteria are met. At least one specific, named gap exists. A follow-up lane must be identified by issue ID before PARTIAL is accepted as a verdict. |
| **BLOCKED** | The milestone cannot be assessed or advanced until a named prerequisite resolves. BLOCKED is not a permanent state — it becomes PARTIAL or PASS when the blocker clears. |

**Inflation guard:** Evidence older than 30 days does not satisfy any criterion unless it is the only data source for that criterion (e.g., historical grading success rates for baseline comparison). Any lane claiming to advance a verdict from PARTIAL to PASS must reference evidence produced after the milestone's designated epoch start.

---

## Epoch Definitions

| Milestone | Evidence Epoch Start | Notes |
|-----------|---------------------|-------|
| M1 — DB Finalization | 2026-06-27 (UTV2-1328 merge) | Spec and execution plan lanes only; no mutations yet |
| M2 — Model-Driven Promotion | 2026-06-27 (UTV2-1327 merge SHA e7d2b2de) | Promotion loop activated |
| M3 — Grading Runtime Proof | 2026-06-27 (UTV2-1331 probe date) | Live grading_runs data required |
| M4 — Evidence-Flow Internal Pick | 2026-06-28 (UTV2-1340 merge) | Internal pick approval protocol adopted |
| M5 — DevOps Finalization | 2026-06-27 (UTV2-1336 probe date) | Monitoring coverage baseline established |

---

## M1 — DB Finalization

**Scope:** Finalize the hot-store / historical-archive / proof-DB architecture and gate all execution lanes.

### PASS Criteria

All of the following must be met:

1. **Architecture spec accepted** — `docs/05_operations/DB_ARCHITECTURE_SPEC.md` exists and has been reviewed by PM (T2 merge = accepted).
2. **Execution plan gated** — `docs/05_operations/DB_EXECUTION_PLAN.md` exists with at least two named execution lanes, each with: prerequisite conditions, success criteria, rollback conditions, and a PM-gated preflight requirement.
3. **No unauthorized mutations** — No DB schema changes, DDL, or batched DELETE have been executed under M1 without a PM-gated preflight lane.
4. **G-CONST-11 addressed** — Retention execution preflight gate is defined (spec at UTV2-1306; execution authorized by PM before any mutation).

### PARTIAL Criteria

PARTIAL is the current verdict when:

- Architecture spec is merged but execution plan is not yet created, OR
- Execution plan exists but one or more required execution lanes have not been started, OR
- G-CONST-11 remains OPEN with no PM-authorized execution date.

**Current state (as of 2026-06-28):** PARTIAL — UTV2-1328 merged (spec done); UTV2-1341 (execution plan) pending.

### BLOCKED Criteria

BLOCKED applies when:

- Supabase schema divergence (UTV2-1274 migration ledger repair) is unresolved and blocks any migration path.
- PM has explicitly gated all M1 execution pending another milestone.

---

## M2 — Model-Driven Promotion

**Scope:** Wire `domainAnalysis` scoring at promotion time and confirm it is exercised in the live promotion loop.

### PASS Criteria

All of the following must be met:

1. **Implementation merged and CI green** — UTV2-1327 (PR #1088, SHA `e7d2b2de`) merged; all 74 unit tests PASS; T1 evidence bundle SHA-bound.
2. **Provenance monitor defined** — A monitor or spec exists (per UTV2-1342) that defines:
   - How to measure domainAnalysis fallback rate (score = 0 vs score > 0)
   - Baseline and alert threshold
3. **Fallback rate below threshold** — Live provenance query shows domainAnalysis fires on ≥ the defined threshold of promotion-eligible picks (threshold defined in UTV2-1342 spec, must be > 0% to confirm the path is live).
4. **No regression** — Subsequent `pnpm test` runs on main continue to pass the 74 promotion tests.

### PARTIAL Criteria

PARTIAL when:

- Implementation is merged and CI green, but provenance monitor is not yet defined (UTV2-1342 pending), OR
- Provenance monitor is defined but the fallback rate has not been measured against live data.

**Current state (as of 2026-06-28):** PARTIAL — UTV2-1327 merged and proven; UTV2-1342 (provenance monitor) pending.

### BLOCKED Criteria

BLOCKED when:

- UTV2-1327 implementation was reverted or is failing CI.
- Live promotion loop is not running (ingestor down, governance brake blocking all candidates).

---

## M3 — Grading Runtime Proof

**Scope:** Prove the grading heartbeat is active and that grading run failure rate is within acceptable bounds.

### PASS Criteria

All of the following must be met:

1. **Heartbeat cron active** — All recent `grading.cron.heartbeat` runs show `succeeded`; no consecutive heartbeat failures in the trailing 7 days.
2. **Failure rate at baseline** — `grading.run` failure rate over the last 7 days is ≤ 5% (baseline: 1.46% historical, tolerance +3.5pp).
3. **Zero-graded run investigation resolved** — The root cause of any run returning `picks_graded = 0` with `status = failed` is documented and either (a) fixed with a merged PR, or (b) attributed to a known external cause (no eligible picks in the window) with evidence.
4. **No consecutive zero-graded failures in the last 24h** — The last 2 `grading.run` entries with `status = failed` do not both show `picks_graded = 0` unless that is explained by game schedule (no games in window).

### PARTIAL Criteria

PARTIAL when:

- Heartbeat cron is running (all cycles PASS) but run failure rate exceeds 5%.
- Failure rate is elevated but a root cause investigation is in-progress (named issue ID).
- Zero-graded failures are present but the investigation (UTV2-1343) is open.

**Current state (as of 2026-06-28):** PARTIAL — Heartbeat 69/69 PASS; run failure rate 34.8% today vs 1.46% historical. Last 2 runs both failed with 0 picks graded. Root cause investigation open: UTV2-1343.

### BLOCKED Criteria

BLOCKED when:

- Supabase is degraded and `system_runs` queries cannot complete.
- Ingestor is wedged and no grading runs are firing at all.

---

## M4 — Evidence-Flow Internal Pick

**Scope:** Demonstrate the internal pick approval flow end-to-end using the `awaiting_approval` lifecycle state and governance brake.

### PASS Criteria

All of the following must be met:

1. **Protocol adopted** — `docs/05_operations/INTERNAL_PICK_APPROVAL_PROTOCOL.md` exists and is merged (UTV2-1340, SHA `4a39db2f`).
2. **Terminal criteria accepted** — This document (UTV2-1339) is merged and accepted.
3. **M3 PARTIAL gap resolved** — UTV2-1343 investigation is closed with a verdict (fix deployed or attributed).
4. **M3 lane closed** — UTV2-1331 lane manifest status is `done`.
5. **End-to-end flow proven** — At least one internal pick has traversed the `awaiting_approval → approved` path in the live system with a recorded `pick_audit_events` row.
6. **Governance brake confirmed** — A test or live observation confirms that autonomous sources cannot bypass the brake and reach `qualified` directly.

### PARTIAL Criteria

PARTIAL when:

- UTV2-1340 is merged and UTV2-1339 is accepted, but the live end-to-end flow has not been exercised (criteria 5 not met).
- The governance brake is confirmed in code but not yet observed live.

**Current state (as of 2026-06-28):** BLOCKED — Prerequisites 2, 3, 4 not yet met (UTV2-1339 is the lane that satisfies criterion 2; UTV2-1343 open for criterion 3; UTV2-1331 must reach `done`).

### BLOCKED Criteria

BLOCKED when any of the following is true:

- This document (terminal criteria) has not been merged (UTV2-1339 lane not done).
- UTV2-1343 root cause investigation is still open.
- UTV2-1331 lane manifest is not in `done` status.
- Governance brake code is broken or bypassed.

---

## M5 — DevOps Finalization

**Scope:** Confirm monitoring coverage across all production components and add grading staleness alerting.

### PASS Criteria

All of the following must be met:

1. **Component monitoring confirmed** — Monitoring exists for: API health endpoint, ingestor cycle monitor, worker queue depth, pipeline throughput. (All four confirmed PRESENT in UTV2-1336 proof.)
2. **Grading staleness alert deployed** — A GHA workflow or equivalent mechanism fires when:
   - Any grading run returns `picks_graded = 0` with `status = failed`, OR
   - No grading run has occurred in the last 24 hours.
3. **Alert tested** — The staleness alert workflow has at least one successful GHA run recorded (not just YAML present in repo).
4. **G-CONST-12 closed** — DB-health tripwire covers full ratified Section 5 surface. (Closed by UTV2-1308, SHA verified.)
5. **No monitoring gap** — `pnpm ops:brief` shows no FAIL state on any production monitoring dimension.

### PARTIAL Criteria

PARTIAL when:

- Component monitoring is confirmed but the grading staleness alert is absent.
- Staleness alert YAML exists in repo but has not yet completed a successful GHA run.

**Current state (as of 2026-06-28):** PARTIAL — UTV2-1336 confirmed component monitoring; grading staleness alert ABSENT. UTV2-1344 lane dispatched to close this gap.

### BLOCKED Criteria

BLOCKED when:

- GHA secrets (`SUPABASE_SERVICE_ROLE_KEY`) are not provisioned for the alert workflow to query the DB.
- The grading cron itself is down, making staleness detection meaningless until it is restored.

---

## Milestone Summary Table

| Milestone | Current Verdict | Open Follow-up Lane | PASS Blocker |
|-----------|----------------|---------------------|--------------|
| M1 — DB Finalization | **PARTIAL** | UTV2-1341 (execution plan) | Execution plan + PM-gated mutation preflight |
| M2 — Model-Driven Promotion | **PARTIAL** | UTV2-1342 (provenance monitor) | Provenance monitor + live fallback rate measured |
| M3 — Grading Runtime Proof | **PARTIAL** | UTV2-1343 (investigation) | Failure rate ≤ 5% + zero-graded runs attributed/fixed |
| M4 — Evidence-Flow Internal Pick | **BLOCKED** | UTV2-1339 (this), UTV2-1343 | UTV2-1339 merged + UTV2-1343 closed + UTV2-1331 done + live flow proven |
| M5 — DevOps Finalization | **PARTIAL** | UTV2-1344 (staleness alert) | Staleness alert deployed + at least one successful GHA run |

---

## Lane Obligation

Every lane that opens a PR against any milestone MUST include a section in its PR body:

```markdown
## Milestone Impact
- **Milestone:** M{N} — {name}
- **Verdict before:** {PASS|PARTIAL|BLOCKED}
- **Verdict after:** {PASS|PARTIAL|BLOCKED}
- **Criterion satisfied:** {cite the exact criterion from PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md}
- **Remaining gaps:** {list any remaining PARTIAL criteria or "none"}
```

If a lane does not advance any milestone verdict, write: "No milestone verdict change."

---

## Changelog

| Date | Change | Lane |
|------|--------|------|
| 2026-06-28 | Document created; M1–M5 terminal criteria defined | UTV2-1339 |
