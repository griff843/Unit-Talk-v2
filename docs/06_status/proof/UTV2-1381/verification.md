# UTV2-1381 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1381-band-assignment-persistence`:

- `pnpm type-check` — pass
- `pnpm exec tsx --test apps/api/src/t1-proof-utv2-988-band-persistence.test.ts` — pass
- `pnpm test` — pass
- `pnpm test:db` — pass
- `pnpm verify` — pass
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — pass after commit

Issue-specific proof:

- Focused live DB band-persistence proof reported `picks.metadata.band = SUPPRESS`.
- Live DB proof reported all three `pick_promotion_history.payload.band` rows set: `trader-insights`, `exclusive-insights`, and `best-bets`.
- Existing historical null-band rows remain classified as pre-determinism historical gap; no backfill was performed in this lane.
- Full `pnpm verify` also passed the live DB smoke and live T1 proof phases.

Coverage note:

- UTV2-1381 changed the exposure-gate suppression path so the persisted band value is written at promotion completion instead of being left absent on that branch.
