# UTV2-723 - SGO model-trust R5 replay

Generated: 2026-04-25

- Verdict: **PASS**
- Reason: PASS: 283 settled candidates with closing-line CLV (>=30)
- Candidates (replay eligible): 493
- Settled: 283
- CLV-computed: 283
- Mean CLV: -2.80%
- Median CLV: 4.28%
- Monotonicity: PASS

## Notes

- Replay script verified after resolving historical participant linkage from `participants.external_id`.
- SGO participant alias backfill applied:
  - `provider_entity_aliases` rows created for 840 SGO player keys
  - unresolved `market_universe` SGO participant rows reduced from 16,936 to 0
