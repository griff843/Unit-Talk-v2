# Diff summary: WORK-2026111101

Scope: the lane's documentation, the audit allow-list line and the work order, excluding `docs/06_status/lanes/**`, `docs/06_status/proof/**` and `.ops/sync/**` (`git diff --stat origin/main...HEAD -- docs/05_operations/ docs/06_status/PROGRAM_STATUS.md scripts/ .ops/work/`).

```
 .ops/work/WORK-2026111101.md                       | 37 ++++++++++++++++++++
 docs/05_operations/PROVIDER_AUTHORITY_LOCK.md      | 40 ++++++++++++++++++++--
 .../05_operations/PROVIDER_DATA_DECISION_RECORD.md | 33 +++++++++++++++++-
 docs/06_status/PROGRAM_STATUS.md                   |  1 +
 scripts/audit-provider-scope.ts                    |  4 +++
 5 files changed, 111 insertions(+), 4 deletions(-)
```

| File | Change |
|---|---|
| `docs/05_operations/PROVIDER_AUTHORITY_LOCK.md` | Amendment A1 block inserted after "Canonical Authority Statement" (Ratified: 2026-11-11 by Griff). Wording edits to the canonical statement, its explanatory paragraph, the Fail-Closed Rule and "What Constitutes Stale Drift". The SGO Pro integration reference rows are unchanged. |
| `docs/05_operations/PROVIDER_DATA_DECISION_RECORD.md` | Status line updated to 2026-11-11. New section "Amendment A1" (A1.1 to A1.5): decision, ratification (Griff and PM, 2026-11-11; PM directive 2026-11-10), rationale, cost envelope, exclusions. Earlier sections unchanged. |
| `docs/06_status/PROGRAM_STATUS.md` | One Provider row added to the Current State table, dated 2026-11-11. |
| `scripts/audit-provider-scope.ts` | One `ALLOWED_HISTORICAL_PATTERNS` entry for A1 game-score files only, plus its header comment (category 11). No other code change. |
| `.ops/work/WORK-2026111101.md` | Repo-owned work order. |

## SHA Binding

Merge SHA: pending merge
PR: pending
