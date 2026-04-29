## UTV2-781 replay proof summary

Branch: `codex/utv2-781-real-replay-proof`

Scope:
- upgrade the provider-offer replay harness from deterministic scaffold to real captured payload replay
- enforce the UTV2-781 freshness SLA as a replay contract
- wire the scanner to `provider_offer_current` only
- suppress `fail` health rows and reduce confidence for `degraded` rows

Proof artifacts:
- [replay-report-1x.json](C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-781/replay-report-1x.json)
- [replay-report-2x.json](C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-781/replay-report-2x.json)

Observed results:
- `1x` replay passed
- `2x` time-compression replay passed
- replay report freshness coverage: `50` provider/sport/market rows, all `fresh` in both runs
- failure taxonomy stayed clean in both runs (`null` source category, `null` replay category)
- request timing fidelity:
  - `1x`: scheduled `1298ms`, observed `1320ms`
  - `2x`: scheduled `649ms`, observed `661ms`

DB/runtime notes:
- the bounded merge path was exercised with chunked merge support
- scanner reads `provider_offer_current` only
- `fail` provider health suppresses candidate materialization
- `degraded` provider health shrinks fair probabilities toward `0.5`

Verification run:
- `pnpm exec tsx --test apps/ingestor/src/provider-offer-replay.test.ts`
- `pnpm exec tsx --test apps/api/src/system-pick-scanner.test.ts`
- `pnpm type-check`
- `pnpm build`
- `pnpm test:db`
- `pnpm verify`

Known follow-up:
- Command Center interactive browser pass was not run in this branch because this slice does not directly change UI behavior.
