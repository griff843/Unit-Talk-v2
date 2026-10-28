# PROOF: WORK-2026102805

MERGE_SHA: pending merge

Issue: WORK-2026102805
Tier: T2
Branch: codex/work-2026102805-smart-form-eastern-game-date
Executor: codex-cli (codex-luna-medium; routing evidence in `model-routing.json`)
Head SHA (last non-proof commit): 23588057b4c33fd2cdfb29a98be7cd17509e1b33
result: pass

## ASSERTIONS:

- [x] `lib/form-utils.ts` exports a pure `easternDateIso(now)` that returns the `America/New_York` calendar date via `Intl.DateTimeFormat`; no dependency added (`form-utils.test.ts`: "easternDateIso returns the Eastern calendar date across standard-time boundaries", "…spring-forward and fall-back boundary instants").
- [x] 2026-10-29T01:30Z (21:30 EDT) maps to 2026-10-28; 2026-12-01T04:59Z maps to 2026-11-30 and 05:00Z to 2026-12-01.
- [x] `BetForm.tsx` no longer has a module-load `TODAY`; the initial values, the reset values and the date-input fallback each call `easternDateIso(new Date())` when evaluated.
- [x] `getRelativeDayPrefix` and `formatTimestampLabel` compare Eastern dates.
- [x] No change to the submission payload shape, validation, API contract, Track Only/delivery choice or authentication; an entered date is sent as entered.

## EVIDENCE:

```text
$ pnpm --filter @unit-talk/smart-form test
# tests 226  # pass 226  # fail 0
$ pnpm --filter @unit-talk/smart-form type-check
exit 0
```

The orchestrator (Claude) re-ran both in the lane worktree on 2026-10-28 with the same result.

Writable live DB: not applicable to a client-side date default. The local run was refused by the staging identity guard as designed; the protected staging-ci proof runs in the required CI `verify` context.

## Verification

- `pnpm verify`: executed by the required CI `verify` check on the PR head (verification of record). Locally, Codex ran `pnpm verify:static` (PASS, Smart Form 226/226) and `pnpm verify:quick` (PASS; baseline `WIRING_GLOB_SHADOWED` warning only).
- `pnpm type-check`: PASS.
- `pnpm test` (focused): `apps/smart-form/test/form-utils.test.ts` 39/39 PASS.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS. `operator-ui` matched; its required artifact is satisfied by a pre-existing QA report, which is not claimed as lane-specific QA evidence.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1797
Execution SHA: 23588057b4c33fd2cdfb29a98be7cd17509e1b33
