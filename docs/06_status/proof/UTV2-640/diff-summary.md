# Diff Summary — UTV2-640

**Merge SHA:** 736fc0ee7f3b08d88cf30a068b87ff512efde167
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/324
**Tier:** T2

## Changes

- `scripts/readiness-report.ts` — new file (271 lines)
  Canonical readiness report CLI. Reports 7 milestone-critical signals:
  worker runtime, outbox health, ingestor freshness, canonical identity
  coverage, settlement coverage, CLV resolution, delivery receipts.
  Explicit thresholds; exits 1 on critical failures. Supports `--json`.

- `package.json` — added `readiness:report` script entry

## Scope

No package boundary changes. No DB changes. No business logic changes.
Script-only change following the pipeline-health.ts pattern.
