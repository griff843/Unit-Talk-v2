# UTV2-1381 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1381-band-assignment-persistence`:

- `pnpm type-check` — pass
- `pnpm exec tsx --test apps/api/src/t1-proof-utv2-988-band-persistence.test.ts` — pass
- `pnpm test` — pass
- `pnpm test:db` — pass
- `pnpm verify` — pass
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — pass after commit

### pnpm test:db TAP output

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 21622.148216
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 18722.115616
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 17699.44416
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 21074.635324
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 779.526854
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 17414.275869
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 18547.659143
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 116648.486862
```

Issue-specific proof:

- Focused live DB band-persistence proof reported `picks.metadata.band = SUPPRESS`.
- Live DB proof reported all three `pick_promotion_history.payload.band` rows set: `trader-insights`, `exclusive-insights`, and `best-bets`.
- Existing historical null-band rows remain classified as pre-determinism historical gap; no backfill was performed in this lane.
- Full `pnpm verify` also passed the live DB smoke and live T1 proof phases.

Coverage note:

- UTV2-1381 changed the exposure-gate suppression path so the persisted band value is written at promotion completion instead of being left absent on that branch.
