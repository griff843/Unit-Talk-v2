# Diff Summary — UTV2-642

**Merge SHA:** e9df8965ee6efd92854df04318bd84afe84c4de9
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/325
**Tier:** T2

## Changes

- `scripts/scoring-provenance.ts` — new file (271 lines)
  Scoring provenance and CLV coverage CLI. Reports 5 signals:
  score provenance mix, market-backed share, CLV coverage,
  auto-grade coverage, blocked pick breakdown by slice.
  Explicit thresholds; exits 1 on RED; supports `--json`.

- `package.json` — added `scoring:coverage` script entry

## Scope

No package boundary changes. No DB changes. No business logic changes.
Script-only change following the pipeline-health.ts pattern.
