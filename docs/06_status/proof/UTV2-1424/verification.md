# PROOF: UTV2-1424

MERGE_SHA: PLACEHOLDER_REBIND_BEFORE_COMMIT

## Summary

Prepares the reviewable amendment diff for PM ratification of
`MODEL_EDGE_ACCEPTANCE_STANDARD.md`, cross-checked against the current live
settled-pick corpus (via `scripts/roi-by-sport.ts --real-edge-only`) rather
than assumed. The corpus is far below every labeled tier's minimums today, so
no threshold numbers needed loosening -- the amendment instead closes gaps in
the ratification/evidence-boundary language (missing/stale evidence must
fail closed to `UNPROVEN`; ratifying the standard is not P3/P4/launch
authority) and cross-references it from `LAUNCH_GATE_DEFINITION.md`. PM
ratifies or amends; this diff does not self-ratify.

## ASSERTIONS:

- [x] Amendment diff prepared against `docs/05_operations/MODEL_EDGE_ACCEPTANCE_STANDARD.md` and `docs/05_operations/LAUNCH_GATE_DEFINITION.md` only
- [x] Thresholds cross-checked against the live settled-pick corpus (real measurement below, not assumed)
- [x] Cross-referenced from `LAUNCH_GATE_DEFINITION.md`'s claim-discipline table so there is one standard, not two
- [x] No runtime code, schema, or delivery path changed
- [x] `pnpm verify` PASS

## EVIDENCE:

```text
$ pnpm type-check
(clean, no errors)
```

```text
$ pnpm test
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
(final sub-suite shown; full aggregate `pnpm test` run exited 0)
```

```text
$ pnpm exec tsx scripts/roi-by-sport.ts --real-edge-only --after=1970-01-01 --monitor-json
tier: "UNPROVEN"
settledRows: 5
stakeKnownRows: 0
clvCoveragePercent: 0
notes:
  - "Sample below DEVELOPING minimum of 50 real-edge-backed settled bets"
  - "CLV coverage below 60% minimum for positive edge labels"
  - "ROI is not positive"
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) -- no R-level artifacts required for this diff
```

## PM gate

Required — PM is the ratifying authority, not Claude/Codex. This diff is the
reviewable amendment only; ratification happens at PM-approved merge.

## Tier

T2 — docs/standard only, no runtime code.
