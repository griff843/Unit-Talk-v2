# PROOF: WORK-2026102804

MERGE_SHA: pending merge

Issue: WORK-2026102804
Tier: T2
Branch: codex/work-2026102804-settlement-score-check
Executor: codex-cli (codex-luna-medium; routing evidence in `model-routing.json`). The orchestrator (Claude) reviewed the work and corrected it to match production pick shapes.
Head SHA (last non-proof commit): 0775eab7cf910f73aaa9267a57aaf2e805536639
result: pass

## ASSERTIONS:

- [x] `checkSettlementScore` resolves moneyline, spread, game total and team total from an entered final score. It returns `unsupported` with a reason for player props, period markets, "vs" event names, unparseable lines and selections it cannot attribute to a team, and never guesses (`settlement-score-check.test.ts`, 9 tests).
- [x] It accepts the shapes production actually persists: `game_total_ou` / `team_total_ou` market keys, `O 6.5` / `Ducks Over 3.5` selections, and string lines such as `"6.50"`. Both real fixtures resolve correctly: Ducks team total over 3.5 at Canucks 6, Ducks 5 is a win; game total over 6.5 at Kings 1, Devils 3 is a loss.
- [x] The pick page passes event, market, selection, line and odds into `SettlementForm`, which shows them above the result buttons. The props are optional, so the settlement workbench call site is unchanged.
- [x] Supported markets require whole-number final scores, labelled with the team names. A decided mismatch blocks submission until an override reason is entered, and that reason is carried in the notes. An undecidable check does not block.
- [x] The entered score (away-home) is appended to `outcomeBasis`. No API, schema, settle contract, authentication, attribution, correction, delivery or containment change.

## EVIDENCE:

```text
$ pnpm exec tsx --test src/lib/settlement-score-check.test.ts   (apps/command-center)
# pass 9  # fail 0
$ pnpm exec tsx --test src/lib/*.test.ts src/lib/*.test.tsx src/lib/data/*.test.ts   (apps/command-center, = pnpm test:command-center)
# tests 710  # pass 710  # fail 0
$ pnpm exec tsc --noEmit -p tsconfig.json   (apps/command-center)
exit 0
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS  (rules matched: operator-ui)
```

Production read-only check, 2026-10-28: real Smart Form picks persist `market` = `game_total_ou` / `team_total_ou`, `selection` = `O 6.5` / `Ducks Over 3.5`, and `line` as a string (`"6.50"`). The tests use these exact shapes.

Writable live DB: not applicable; this is client-side form logic with no new read or write. The protected staging-ci proof runs in the required CI `verify` context.

## Verification

- `pnpm verify`: executed by the required CI `verify` check on the PR head (verification of record).
- `pnpm type-check`: Command Center `tsc --noEmit` exit 0 on 0775eab7cf910f73aaa9267a57aaf2e805536639.
- `pnpm test` (focused): `pnpm test:command-center` 710/710 PASS on 0775eab7cf910f73aaa9267a57aaf2e805536639.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1799
Execution SHA: 0775eab7cf910f73aaa9267a57aaf2e805536639
