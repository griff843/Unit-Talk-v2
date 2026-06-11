# UTV2-1261 — Proof

**Branch:** `claude/utv2-1261-canonical-pipeline-vocabulary`
**Tier:** T2 / governance

## Summary

Created `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md` — the authoritative source for 11 pipeline terms whose near-synonymous usage was producing incorrect monitoring counts and verdict reports.

Definitions cover: evidence-settled, true settled CLV-path, pick.status='settled', hasRealEdge, posted_at, awaiting_approval, shadow, voided, production-path, pick_offer_snapshots.closing_for_clv, and grading run_status.

## Evidence

Docs-only change. No code or schema modifications.

### pnpm test:db

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 151047.848351
```

## Verification

- New file: `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md`
- No code changes. No test changes. No schema changes.
- `pnpm test:db`: 7/7 pass, 0 fail — DB integrity preserved
- All 11 required terms defined with explicit non-equivalences
- SQL query patterns provided for evidence-settled and CLV-path counts
- Content verified against PM clarification definitions (monitor language + data sufficiency):
  - `evidence-settled` ≠ `pick.status='settled'` ✓
  - `true settled CLV-path` definition includes candidate join + clvStatus='computed' ✓
  - `posted_at IS NULL` ≠ game not started ✓
  - `awaiting_approval` ≠ excluded from grading ✓
  - `closing_for_clv snapshot absent` ≠ closing odds missing ✓
<!-- CI trigger -->
