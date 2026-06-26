# UTV2-1322 — Verification

**Lane:** UTV2-1322 Production DB Truth Audit
**Branch:** `claude/utv2-1322-production-db-truth-audit`
**Tier:** T2 governance
**Date:** 2026-06-26
**PM Authorization:** PM directive: priority=2; goal = production DB truth audit (PASS/YELLOW/RED verdict).

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

Docs-only lane. pnpm test:db run confirms DB health at time of lane.

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

Result: **PASS (7/7 live-DB tests, 0 failures)**

---

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Changed files:
  docs/06_status/readiness/PRODUCTION_DB_TRUTH_AUDIT.md
  docs/06_status/proof/UTV2-1322/verification.md
  docs/06_status/proof/UTV2-1322/diff-summary.md
  docs/06_status/lanes/UTV2-1322.json

Rules matched: PASS — docs-only changes; no runtime, migration, or schema paths
```

Result: **PASS**

---

### Evidence Sources

This lane is a docs audit — no code changes, no DB mutation. Evidence sources:

1. **Code inspection** — `apps/ingestor/src/`, `apps/api/src/`, `supabase/migrations/` (baseline schema)
2. **Incident history** — system_runs bloat incident 2026-06-22; game_results freeze UTV2-1294; archive write timeout UTV2-1294
3. **Prior lane proofs** — UTV2-1315 (markClosingLines partition pruning), UTV2-1321 (settlement listRecent), UTV2-1296 (dedup pruning)
4. **Known debt** — `docs/06_status/KNOWN_DEBT.md` entries DEBT-001, DEBT-010, DEBT-018, DEBT-019, DEBT-020
5. **Open lanes** — UTV2-1326 (settle_pick_atomic timeout), UTV2-1274 (migration ledger repair)

---

### Before/After Summary

| Dimension | Before (state of knowledge) | After (this lane) |
|---|---|---|
| DB verdict | Unknown | PARTIAL — explicit with evidence table |
| Partition strategy | "Known to have issues" | Proven PASS: 6 indexes per partition, auto-created |
| Timeout incidents | 5 known; status unclear | 4/5 fixed (UTV2-1315/1321/1296/1294); 1 open (UTV2-1326) |
| Migration ledger | "Has drift" | Quantified: 3 out-of-band divergences; UTV2-1274 pending |
| Backup/PITR | Unknown | Classified UNKNOWN (Supabase managed; not verifiable from code) |
| Monitoring posture | Unknown | PARTIAL — ops:brief only; no DB alert path |
| Follow-up lanes | Unidentified | 4 concrete follow-up lanes enumerated |

---

## Summary

| Check | Result |
|---|---|
| pnpm verify | PASS |
| pnpm type-check | PASS |
| pnpm test (unit) | PASS (113/113) |
| pnpm test:db | PASS (7/7) |
| R-level check | PASS |
| Output artifact | `docs/06_status/readiness/PRODUCTION_DB_TRUTH_AUDIT.md` |
| DB mutation | NONE |
| Certification status change | NONE |

---

## Merge SHA Binding

**Branch HEAD SHA:** `(to be bound post-merge)`
**PR:** (to be opened)
**Merge SHA:** `(to be bound post-merge)`
**Merged at:** (pending)
