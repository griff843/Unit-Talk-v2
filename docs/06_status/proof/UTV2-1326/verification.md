# UTV2-1326 — Verification

**Lane:** UTV2-1326 settle_pick_atomic RPC timeout investigation
**Branch:** `claude/utv2-1326-settle-pick-atomic-timeout`
**Tier:** T2 runtime
**Date:** 2026-06-27
**PM Authorization:** PM directive: priority=2; isolate settle_pick_atomic timeout; implement narrow fix if safe.

---

## Verification

### pnpm verify

```
pnpm verify
PASS — type-check + lint + build + test all green
# pass 113
# fail 0
# skipped 0
```

Result: **PASS**

---

### pnpm type-check

```
pnpm type-check
PASS — no TypeScript errors
```

Result: **PASS**

---

### pnpm test (unit tests)

```
pnpm test
# pass 113
# fail 0
```

Result: **PASS (113 unit tests, 0 failures)**

---

### pnpm test:db (live-DB smoke test)

```
pnpm test:db
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Result: **PASS (7/7 live-DB tests including atomic settlement path)**

---

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Changed files:
  packages/db/src/runtime-repositories.ts
  docs/06_status/proof/UTV2-1326/verification.md
  docs/06_status/proof/UTV2-1326/diff-summary.md
  docs/06_status/lanes/UTV2-1326.json

Rules matched: R2 (runtime change in packages/db) — proof files present, test:db run confirmed
```

Result: **PASS**

---

## Investigation Findings

### Root cause

`settle_pick_atomic` holds a `picks FOR UPDATE` row lock from step 2 through step 6 of the transaction:

1. SELECT settlement_records (duplicate check) — no lock
2. SELECT picks FOR UPDATE — **lock acquired**
3. INSERT settlement_records + trigger (stake_units SELECT from picks)
4. UPDATE picks SET status
5. INSERT pick_lifecycle
6. INSERT audit_log — **lock released on commit**

Under peak load, two sources amplify lock hold time and write latency:

- **audit_log write pressure** — 3 indexes + immutability trigger per insert; in 2026-06-22 incident, audit_log inserts timed out under system_runs bloat load
- **picks index contention** — 8 indexes on picks; batch settlement (grading-cron running) creates page-level contention on shared index pages (status_idx, awaiting_approval_idx)

The timeout is **transient/load-amplified**, not a query-shape bug (unlike the partition-scan bugs in UTV2-1315/1321/1296). It surfaces under peak DB load; it is not reproducible at current load (0 post-Phase7A settlements, system_runs cleanup post-2026-06-22 incident).

### What was NOT the issue

- `settlement_records` indexes — well-covered (4 indexes; unique index on pick_id+source enables efficient duplicate check)
- `pick_lifecycle` indexes — 2 indexes, straightforward
- Query shape inside the RPC — no missing lower-bounds or full-table scans (distinct from the partition-scan class)
- Structural defect in the SQL — function logic is correct and fail-closed

### Fix implemented

Added single retry on `statement_timeout` in `DatabaseSettlementRepository.settlePickAtomic`:

```
packages/db/src/runtime-repositories.ts
  + isStatementTimeoutError() helper (PostgreSQL code 57014 or message match)
  + 500ms backoff + 1 retry on timeout in settlePickAtomic
```

**Safety:** The RPC is transactional — a timeout means the DB rolled back the transaction. Retry is idempotent: a new settlement attempt on an already-settled pick hits the duplicate check at step 1 and returns early. No double-settlement risk.

**Scope:** Narrow — 1 function modified, no schema changes, no migration required.

---

## Summary

| Check | Result |
|---|---|
| pnpm verify | PASS |
| pnpm type-check | PASS |
| pnpm test (unit) | PASS (113/113) |
| pnpm test:db | PASS (7/7, including atomic settlement) |
| R-level check | PASS |
| Verdict | NEEDS FIX → fix implemented (application-layer retry) |
| Root cause | picks FOR UPDATE lock hold time + audit_log write pressure under peak load |
| Schema migration required | NO |
| Residual risk | Future table bloat could still amplify; monitor autovacuum |

---

## Merge SHA Binding

**Branch HEAD SHA:** `(to be bound post-merge)`
**PR:** (to be opened)
**Merge SHA:** `(to be bound post-merge)`
**Merged at:** (pending)
