# UTV2-1266 Diff Summary

## Summary

SGO ingestor: remove `includeAltLines` from historical request path, add `pinnacleOnly` peak-window filter.

## Files Changed

| File | Change |
|------|--------|
| `apps/ingestor/src/sgo-request-contract.ts` | Remove `includeAltLines` from historical path; add `pinnacleOnly?: boolean` |
| `apps/ingestor/src/sgo-fetcher.ts` | Add `pinnacleOnly` to `SGOFetchOptions` |
| `apps/ingestor/src/ingest-league.ts` | Pass `pinnacleOnly` through to fetcher |
| `apps/ingestor/src/ingestor-runner.ts` | Add `pinnacleOnlyPeak` option; resolve per-cycle using scheduler mode |
| `apps/ingestor/src/scheduler.ts` | Add `UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK` to `SchedulerEnv` |
| `apps/ingestor/src/index.ts` | Wire `pinnacleOnlyPeak` from env into runner |
| `apps/ingestor/src/ingestor.test.ts` | Update test: assert `includeAltLines=null` (was `'true'`) |
| `apps/ingestor/src/scripts/verify-utv2-1266.ts` | New proof script: 7 assertions all pass |
| `.env.container.example` | Add 6 scheduling env vars |
| `.lane/lanes/runtime.yml` | Add `.env.container.example` and `PROVIDER_KNOWLEDGE_BASE.md` to allowed paths |
| `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` | Add §1.12: includeAltLines permanently disabled |
| `docs/06_status/proof/UTV2-1266/verification.md` | Proof document |
| `docs/06_status/proof/UTV2-1266/diff-summary.md` | This file |

## Key Changes

- **Root cause fix**: `includeAltLines=true` caused alt-line contamination in historical mode (bd9d71a6 Champagnie 3PM 2.5 vs main line 1.5). Now permanently removed.
- **CLV preserved**: `includeOpenCloseOdds=true` and `includeOpposingOdds=true` unchanged.
- **Peak-window filter**: `bookmakerID=pinnacle` gated on `UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=true` AND scheduler in peak mode.
- **No runtime behavior change** for normal polling (pinnacleOnly off by default).

## Evidence

- 7/7 assertions pass in `apps/ingestor/src/scripts/verify-utv2-1266.ts`
- pnpm verify: 86 tests pass, type-check clean, build clean
