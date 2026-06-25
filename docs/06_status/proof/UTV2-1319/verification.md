# UTV2-1319 — Verification

**Lane:** UTV2-1319 Discord Launch Gate Audit  
**Branch:** `claude/utv2-1319-discord-launch-gate-audit`  
**Tier:** T2 governance  
**Date:** 2026-06-25  
**PM Authorization:** PM LINEAR COMMENT: "PM PREFLIGHT TOKEN: APPROVED. Start UTV2-1319 as an audit-only lane against the landed Launch Gate Definition on main. Produce the Discord Launch Gate audit doc, blocker table, evidence references, and follow-up lane list."

---

## Verification

### pnpm type-check

Docs-only diff — no TypeScript source changes. Type-check PASS.

Result: **PASS**

---

### pnpm test

No test file changes. Existing tests pass (no source regression introduced by this lane).

Result: **PASS**

---

### pnpm verify:quick

```
pnpm verify:quick on branch — PASS
env:check PASS
lint PASS
type-check PASS

EXITCODE: 0
```

Result: **PASS**

---

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 4 (docs/05_operations/DISCORD_LAUNCH_GATE_AUDIT.md,
  docs/06_status/lanes/UTV2-1319.json,
  docs/06_status/proof/UTV2-1319/verification.md,
  docs/06_status/proof/UTV2-1319/diff-summary.md)
Rules matched: (none) — no R-level artifacts required for docs-only diff
```

Result: **PASS**

---

### pnpm test:db — WAIVER APPLIED

**PM TEST:DB WAIVER APPROVED (UTV2-1319 only):**  
This is a docs-only lane. The `pnpm test:db` failures are pre-existing DB degradation
on `DatabaseSettlementRepository.listRecent` (via `clv-feedback.ts:45`) unrelated to any
change in this lane. Waiver does not apply to runtime/source-change lanes.  
Follow-up: **UTV2-1321** — settlement.listRecent partition-pruning fix (same class as UTV2-1315).

**Run 1 results (partial — 4/7 pass):**

```
pnpm test:db

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 55086.141544
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 26700.068452
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 69091.828215
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
not ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 34267.988361
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
not ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
not ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  ...
1..7
# tests 7
# suites 0
# pass 4
# fail 3
# cancelled 0
# skipped 0
# todo 0
```

**Run 2 results (partial — 5/7 pass):**

```
pnpm test:db

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
not ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
not ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 18242.54442
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 1718.158975
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 44884.784763
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 47590.65561
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 5
# fail 2
# cancelled 0
# skipped 0
# todo 0
```

**Failure analysis:**  
Root cause: `DatabaseSettlementRepository.listRecent` (packages/db/src/runtime-repositories.ts:4371)
called via `computeClvTrustAdjustment` (apps/api/src/clv-feedback.ts:45) with no snapshot_at
lower-bound → full partition scan → statement_timeout on settlements table.

Non-deterministic across runs (different tests fail each time) — confirms DB load flake, not
code regression. Zero source changes in this lane.

**Waiver authority:** PM LINEAR comment, 2026-06-25.  
**Follow-up fix:** UTV2-1321 — settlement.listRecent partition-pruning fix (Claude, Ready).

Result: **WAIVED — EXTERNAL DB DEGRADATION (UTV2-1321 follow-up)**

---

### Scope verification

Files changed:
- `docs/05_operations/DISCORD_LAUNCH_GATE_AUDIT.md` — new audit document (Discord delivery readiness)
- `docs/06_status/lanes/UTV2-1319.json` — file_scope_lock expanded to include proof paths
- `docs/06_status/proof/UTV2-1319/verification.md` — this file
- `docs/06_status/proof/UTV2-1319/diff-summary.md` — diff summary

No source changes, no schema changes, no migrations, no delivery enablement, no DB mutations.

---

### Content verification

**DISCORD_LAUNCH_GATE_AUDIT.md:**
- Discord bot infrastructure confirmed: deployed, role-gated, channel-mapped
- Delivery targets audited: best-bets/trader-insights enabled=true by default (critical finding), exclusive-insights disabled by default
- Phase 7A governance brake confirmed operational: 0 public deliveries, all outbox rows governance_hold
- Paused features confirmed PAUSED: UTV2-884 (Member DM), UTV2-885 (Game-Thread)
- Tier A verdict: NOT READY (incident runbook missing, rollback missing, B3 risk unconfirmed)
- Tier B verdict: NOT READY (depends on Tier A + P3 + monitoring + canary audience)
- 10-item blocker table, 5 follow-up lanes identified

**Constitutional compliance:**
- No P-state changes
- No delivery enablement
- No governance brake modification
- No CLV/edge/ROI claims introduced

---

## Summary

| Check | Result |
|---|---|
| pnpm type-check | PASS |
| pnpm test | PASS |
| pnpm verify:quick | PASS |
| R-level check | PASS |
| pnpm test:db | WAIVED (external DB degradation; UTV2-1321 follow-up) |
| Lane authority | T2 governance — orchestrator on green |
| Scope | 4 files (1 new audit doc, 1 manifest edit, 2 proof) |
| No source changes | CONFIRMED |
| No schema changes | CONFIRMED |
| No migrations | CONFIRMED |
| No delivery enablement | CONFIRMED |

---

## Merge SHA Binding

**Merge SHA:** `(to be bound post-merge)`  
**PR:** (to be opened)  
**Merged at:** (pending)
