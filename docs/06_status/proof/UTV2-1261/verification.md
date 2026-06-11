# UTV2-1261 — Proof

**Branch:** `claude/utv2-1261-canonical-pipeline-vocabulary`
**Tier:** T2 / governance

## Summary

Created `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md` — the authoritative source for 11 pipeline terms whose near-synonymous usage was producing incorrect monitoring counts and verdict reports.

Definitions cover: evidence-settled, true settled CLV-path, pick.status='settled', hasRealEdge, posted_at, awaiting_approval, shadow, voided, production-path, pick_offer_snapshots.closing_for_clv, and grading run_status.

## Evidence

- New file: `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md`
- File size: non-empty, no placeholder text
- Terms defined: 11 (all required by UTV2-1261 PM directive)
- Non-equivalence table: present
- Operational SQL query patterns: present for evidence-settled and CLV-path counts
- Cross-references to CLV source hierarchy (INIT-4.3.1) and UTV2-1260 grading fix: present

## Verification

- Docs-only change; no code paths modified
- No `pnpm verify` failures possible from a docs-only commit (type-check does not validate `.md` files)
- Content verified against PM clarification definitions from UTV2-1250 / UTV2-1042 PM message:
  - `evidence-settled` ≠ `pick.status='settled'` ✓
  - `true settled CLV-path` definition includes candidate join + clvStatus='computed' ✓
  - `posted_at IS NULL` ≠ game not started ✓
  - `awaiting_approval` ≠ excluded from grading ✓
  - `closing_for_clv snapshot absent` ≠ closing odds missing ✓
