# PROOF: WORK-2026102501

MERGE_SHA: pending merge

Issue: WORK-2026102501
Tier: T2
result: pass

## ASSERTIONS:

- [x] Every catalog stat type for NHL, NBA, MLB and NFL listed in the unit test resolves a market key without throwing (`every catalog stat type for NHL, NBA, MLB and NFL resolves a market key without throwing`).
- [x] The lookup is sport-aware: NHL Points resolves to `player_hockey_points_ou`, NBA Points to `player.points` (`player prop market keys are sport-aware`).
- [x] Previously unmapped stat types resolve to production market ids (`previously unmapped catalog stat types resolve to production market ids`).
- [x] An unknown stat type, or one from another sport, is refused with the explicit "Cannot resolve canonical market key" error and never falls back (`an unknown stat type is refused explicitly`).
- [x] A real Playwright run of the NHL Shots on Goal case returned HTTP 201, persisted the row with `distributionMode: track-only`, and found no outbox row.

## EVIDENCE:

Code commit under test: `91604fffd742afcce8d654d02dd9fbc981a30175`. Files: `apps/smart-form/lib/form-utils.ts`, `apps/smart-form/test/form-utils.test.ts`, `apps/smart-form/e2e/phase-one.spec.ts`.

```
$ pnpm exec tsx --test apps/smart-form/test/form-utils.test.ts
# tests 37
# pass 37
# fail 0
# skipped 0

$ pnpm --filter @unit-talk/smart-form test
# tests 215
# pass 215
# fail 0

$ UNIT_TALK_SMART_FORM_E2E=1 NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1 pnpm exec playwright test e2e/phase-one.spec.ts
  23 passed (1.1m)
```

The NBA Points case (Celtics Starter, 27.5, -115, 2u) and the NHL Shots on Goal case (Bruins Starter, 3.5, -120, 3u) each read the persisted pick back from the in-memory API and assert market key (`points-all-game-ou` / `shots-all-game-ou`), participant id and display name, stat, line, odds, stake units, submittedBy/capper, `distributionMode: track-only`, and zero distribution_outbox rows.

Production reference data, read-only SELECT on `market_types` and `sport_market_type_availability` (project zfzdnfwdarxucxtaojxm):

```
form key (sport)                         canonical id                   exists  available for sport
player_hockey_points_ou (NHL)            player_hockey_points_ou        yes     NHL
player.assists (NHL)                     player_assists_ou (shared)     yes     NBA,NCAAB,NHL,WNBA
player_goals_against_ou (NHL)            player_goals_against_ou        yes     NHL
player_save_pct_ou (NHL)                 player_save_pct_ou             yes     NHL
player_plus_minus_ou (NHL/NBA/WNBA)      player_plus_minus_ou           yes     NBA,NHL,WNBA
player_fgm_ou / player_ftm_ou            same                           yes     NBA,WNBA
player_minutes_ou (NBA/WNBA)             same                           yes     NBA,WNBA
player_sacks_ou (NFL)                    same                           yes     NFL
MLB Runs                                 none                           NO      refused explicitly, no id invented
NCAAB FGM/FTM/Minutes/Plus-Minus         exist for NBA,WNBA only        no      refused for NCAAB
NCAAF Sacks                              player_sacks_ou is NFL only    no      refused for NCAAF
```

Scope of the diff figure (implementation files only, excluding `docs/06_status/**`):

```
$ git diff --stat origin/main...HEAD -- apps/
 3 files changed, 315 insertions(+), 17 deletions(-)
```

## Verification

Commands run on code commit `91604fffd742afcce8d654d02dd9fbc981a30175`:

- `pnpm exec tsx --test apps/smart-form/test/form-utils.test.ts`: 37 pass, 0 fail.
- `pnpm --filter @unit-talk/smart-form test`: 215 pass, 0 fail.
- `pnpm --filter @unit-talk/smart-form type-check`, `pnpm type-check`, `pnpm lint`: each exited 0.
- `ops:preflight WORK-2026102501 --refresh --tier T2`: VERDICT PASS (39 checks).
- Full `pnpm verify` runs in CI on this PR; it cannot exit 0 locally.

The branch was refreshed with `pnpm ops:merge-wrapper pr-update-branch` (merge commit `ddce4739d77491d0921ac9a47b5557192eed5304`, from main's plan and lane files); an earlier local merge `c132a9f67` ( which changed only `docs/06_status/readiness/readiness-score.json`); the later commits change only `apps/smart-form` test and e2e files plus this proof.

Not done, with reason: the e2e gate is off by default and was run only for the files above against the isolated in-memory API (Supabase variables blank, no staging or production access). The full `phase-one.spec.ts` now passes (23 of 23). The earlier failures (9 on `origin/main`, 6 on this branch) were all stale wording: headings were deliberately renamed (`Pick Saved` to `Saved as Track Only`, `Track Only · Internal` to `Track Only requested`), so the assertions were updated in `phase-one.spec.ts` only; no product regression was found. Selection-time hiding of unmapped stat types in `BetForm.tsx` was not done: that file is outside the declared file scope.

## Provenance

This lane was admitted declaring `codex-cli` (profile `codex-sol-high`), but the implementation and verification were performed by Claude, not by `scripts/ops/codex-exec.ts`. The declaration was wrong. Under PM direction the lane was readmitted with `--executor claude`, so the manifest now declares `claude` and requires no `model-routing.json`. No sidecar was fabricated and no Codex run is claimed. The work-order contract, landed on `main` through the governance change for WORK-2026102602, records the same correction.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 1a8d841fc0e7fa13ef59eeec8f56317bb76b9061
