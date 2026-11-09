# PROOF: WORK-2026110801

MERGE_SHA: 71ddbd0de05b7059a4797e0eb636e2bd296796fc

Issue: WORK-2026110801
Tier: T2
result: pass (pre-merge; exact-head CI recorded on the PR)

## Scope

Production runtime acceptance of Deploy run 42418995085 (2026-11-08) measured grading cycles about 17.1 min apart (12 min pass + 5 min poll). The liveness marker was refreshed only at the end of a cycle, while the compose probe and `isGradingCronFresh` fail beyond 3 x `UNIT_TALK_GRADING_CRON_POLL_MS` (15 min at the default), so the marker was stale for about 2 min per cycle. This lane also refreshes the marker at cycle start. No in-pass timer is added, so a hung pass still goes stale. Production container health was not observable from the session (no host access); the flapping is predicted from the code and the measured cadence, not observed.

## Poll-interval consistency (code read)

All three consumers derive from the same `UNIT_TALK_GRADING_CRON_POLL_MS`, default 300000: the loop (`createGradingCronRuntimeDependencies` -> `pollIntervalMs`), `grading-cron-health.ts` (`isGradingCronFresh` CLI, same default, threshold 3 x poll) and the compose probe (`node -e`, same default, `a<=3*poll`). One edge: the loop's `parsePositiveInt` accepts `0` (a zero poll), while the probe and `isGradingCronFresh` treat `0` as invalid/default; not changed here.

## Bound (stated, not widened)

Marker age during a pass equals the pass duration; between cycles it is at most the poll. The container reads healthy while pass duration <= 3 x poll (15 min at the default), plus the probe's `interval: 60s` x `retries: 3` before Docker flags it. A legitimate pass longer than 15 min is indistinguishable from a hang and reads unhealthy. The measured pass is about 12 min over 22,296 stale picks, so the margin is about 3 min and shrinks as that scan grows; the rescan itself is a separate follow-up, not part of this lane.

## ASSERTIONS:

- [x] Liveness is refreshed before the pass in every cycle (test: "liveness is refreshed before the grading pass in every cycle").
- [x] A failing pass leaves the start refresh recorded, and #1837 retry/backoff/exhaustion-alert behaviour is unchanged (test: "a failing pass still leaves the start-of-cycle refresh recorded...").
- [x] Start-of-cycle and end-of-cycle refresh write failures use the same bounded recovery (two tests).
- [x] A normal 12 min pass with a 5 min poll stays healthy through 4 cycles sampled each minute (real marker file, injected clock).
- [x] A pass at exactly 15 min is healthy; a 17 min pass reads unhealthy at minutes 16 and 17 (hung-pass detection preserved).
- [x] Mutation: removing the start refresh fails 9 tests including the 12 min healthy-timeline and 17 min bound tests.

## EVIDENCE:

```text
tsx --test apps/api/src/grading-cron.test.ts   -> tests 31, pass 31, fail 0
pnpm type-check                                -> exit 0
eslint apps/api/src/grading-cron.ts apps/api/src/grading-cron.test.ts -> exit 0
Mutation (start refresh removed)               -> tests 31, pass 22, fail 9
  not ok: transient startRun/completeRun/listByType recovery (3), liveness write failures start/end (2),
  refreshed-before-pass ordering, failing-pass ordering, 12 min healthy timeline, 15/17 min bound timeline
```

## Verification

Code commit: `a48dccf93a3db3d618c4bb688843689d24df0188` (PR head at CI time `b8d9c5bd8350b270650e07eea7f172c4ed45ee53`, which adds only the lane-binding bot commit).

- `pnpm type-check`: exit 0.
- `pnpm test`: exit 0; 7899 tests, 7886 pass, 0 fail, 13 skipped.
- `tsx --test apps/api/src/grading-cron.test.ts`: 31/31.
- R-level command: `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` -> Verdict PASS, no R-level artifacts required for this diff.
- `pnpm verify` (local, at `78b8e2f07`): the `verify:static` half passed in full (db-client-boundary, ops checks, env:check, lint, type-check, build, test, production-post-migration 14/14, smart-form 227/227, verify:commands). The `test:live-db` half stopped at `ci:assert-staging`, which refuses a local 127.0.0.1 target by design (requires staging `xskgrzbteyqdufktjrjx`); that stage is covered by CI's Writable DB proof (staging only) and is not a result of this change. Overall local `pnpm verify` exit: 1 for that reason only.
- CI on `b8d9c5bd8`: `verify` pass; Writable DB proof (staging only) pass, 9/9 against staging `xskgrzbteyqdufktjrjx` (generic smoke suite; it does not exercise the cron loop).
- Executor: the lane manifest declares codex-cli routing; the implementation was written directly by the Claude orchestrator and codex-cli was not run. `model-routing.json` records the declared routing and `not_observed`.

## Merge SHA Binding

Merge SHA: `71ddbd0de05b7059a4797e0eb636e2bd296796fc`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1838
