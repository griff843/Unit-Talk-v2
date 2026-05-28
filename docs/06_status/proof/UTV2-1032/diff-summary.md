## Summary

UTV2-1032 added the `--real-edge-only` proof mode to `scripts/roi-by-sport.ts` and clarified the DEVELOPING sample requirement in `MODEL_EDGE_ACCEPTANCE_STANDARD.md`.

**Merge SHA:** db497b886e1772259555d755ca2018708647ce1b
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/900

## Files Changed

- `scripts/roi-by-sport.ts`: fetches latest promotion-history payloads, classifies settlement rows as `real-edge-backed`, `confidence-proxy`, or `unknown`, and filters ROI/monitor output when `--real-edge-only` is passed.
- `docs/05_operations/MODEL_EDGE_ACCEPTANCE_STANDARD.md`: clarifies that DEVELOPING requires at least 50 real-edge-backed settled bets and excludes confidence-proxy rows.
- `docs/06_status/proof/UTV2-1032/evidence.json`: records the data-gated proof result.

## Proof Result

`pnpm exec tsx scripts/roi-by-sport.ts --real-edge-only --after=2026-05-10 --monitor-json` returned 0 real-edge-backed settled picks. An all-time control query returned 5. The DEVELOPING label was not asserted because the 50-pick threshold, positive ROI, and 60% CLV coverage criteria are not met.
