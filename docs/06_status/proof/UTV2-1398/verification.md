# PROOF: UTV2-1398

MERGE_SHA: c67facf1cbaffe5a08754becd2a5e6008b909fa1

Pre-merge proof, bound to the implementation commit above. Actual merge SHA
is bound by governed post-merge truth-close per `EXECUTION_TRUTH_MODEL.md`.

## ASSERTIONS:

- [x] `classifyMarketFamily('nba-spread')` returns `'game-line'` (new fixture test, `promotion-weight-profiles.test.ts`)
- [x] No other classifier pattern, weight, threshold, or cap value changed
- [x] All 38 existing + new unit tests in `promotion-weight-profiles.test.ts` pass
- [x] `pnpm verify` PASS (static + DB smoke 7/7 + live T1 proof)
- [x] `pnpm test:db` PASS standalone (7/7, 0 failures, 0 skipped)
- [x] R-level check PASS, no rules matched
- [x] Single-line revert path preserved (no migration, no data change)

## EVIDENCE:

Implementation commit: `c67facf1cbaffe5a08754becd2a5e6008b909fa1`

### Unit test run (`promotion-weight-profiles.test.ts`)

```text
1..38
# tests 38
# suites 0
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 368.851643
```

### `pnpm test:db` (standalone)

```text
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 109258.930686
```

### `pnpm type-check`

Clean, no errors.

### R-level compliance

```text
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

## Owner boundary

This is a T1 lane (Linear tier label `tier:T1`, live-verified — corrects an
earlier T2 assumption). Merge requires the `t1-approved` label and a valid
Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head.
This proof supplies neither; it is executor-produced mechanical evidence
only.
