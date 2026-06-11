# UTV2-1261 — Diff Summary

**Branch:** `claude/utv2-1261-canonical-pipeline-vocabulary`
**Tier:** T2 / governance

## Summary

Docs-only governance lane. Creates the canonical vocabulary document at `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md`.

## Files Changed

| File | Change |
|------|--------|
| `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md` | New file — 11 canonical term definitions |

## Change Detail

The document codifies distinctions between near-synonymous terms that were causing incorrect monitoring counts in UTV2-1250 monitoring and an incorrect INSUFFICIENT_DATA verdict in UTV2-1042. Specifically:

- `evidence-settled` vs `pick.status='settled'` — lifecycle column ≠ settlement record quality
- `true settled CLV-path` — requires candidate join + clvStatus='computed', not just evidence-settled
- `posted_at IS NULL` — delivery field, not event-start indicator
- `awaiting_approval` — does not exclude picks from grading or evidence accumulation
- `pick_offer_snapshots.closing_for_clv` — queryability layer, not the authoritative closing odds source

## Evidence

```
docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md created
```

No code changes. No test changes. No schema changes.
