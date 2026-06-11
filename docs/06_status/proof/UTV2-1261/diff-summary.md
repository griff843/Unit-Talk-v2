# UTV2-1261 — Diff Summary

**Branch:** `claude/utv2-1261-canonical-pipeline-vocabulary`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1015
**Merge SHA:** `f5a0661edf7f166aedb961da5c0cd7419ec9f04a`
**Tier:** T2 / governance

## Summary

Docs-only governance lane. Creates the canonical vocabulary document at `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md`.

## Files Changed

| File | Change |
|------|--------|
| `docs/02_architecture/CANONICAL_PIPELINE_VOCABULARY.md` | New file — 11 canonical term definitions |

## Change Detail

The document codifies distinctions between near-synonymous terms that were causing incorrect monitoring counts and an incorrect data-sufficiency verdict in the pipeline. Specifically:

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
