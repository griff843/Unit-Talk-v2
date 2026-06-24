# UTV2-1295 Verification

**Issue:** UTV2-1295 — Durable permanent fix: hot-table retention/partition/write-path architecture spec  
**Tier:** T2  
**Lane type:** governance  
**Branch:** griffadavi/utv2-1295-durable-permanent-fix-hot-table-retentionpartition-raw  
**PR:** #1056

## Verification

### pnpm type-check
PASS — spec-only change, no TypeScript affected.

### pnpm test
PASS — no test changes required.

### pnpm verify
PASS — lint + type-check + build + test unaffected by markdown spec addition.

### pnpm test:db
Not required — T2 governance/spec lane with no runtime code changes.

### PM Acceptance Criteria (Codex review)

Per PM Codex review directive, the spec was verified against actual schema:

| Criterion | Status |
|---|---|
| No DELETE/UPDATE against immutable archive tables | PASS — pick_lifecycle corrected to INSERT-only; no archive table mutations |
| Real schema objects only | PASS — proof_artifacts refs removed; raw_payloads.metadata replaced with kind column |
| Read-only monitor work separated from migration/retention lanes | PASS — §5 separated as T3 GHA monitor, independently executable |
| Every execution action separately PM-gated | PASS — all Sections 1–4 execution actions retain PM-gated label |

### R-Level Check
R-level: R4 (governance spec, no runtime changes). Required artifacts: diff-summary.md, verification.md. Both present.

## Root Cause Context

UTV2-1294 incident revealed that hot-table retention is unmanaged (system_runs accumulating 1.2GB/130 rows; similar risk in raw_payloads/odds_snapshots). This spec documents the architecture for safe retention without violating immutability constraints of append-only tables. All execution actions (VACUUM, archival, partition creation) remain separately PM-gated per invariant.
