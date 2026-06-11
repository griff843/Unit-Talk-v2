# UTV2-1255 Runtime Verification

Generated at: 2026-06-11T04:03:29.710Z
Issue: UTV2-1255
Tier: T2
Lane type: governance
Branch: claude/utv2-1255-deploy-target-map-default
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1007
Head SHA: fb07846a4404bddd954d4011ffa85c4356e561e8
Merge SHA: e5634c9878b185bb18965b182a70f97cfa6258d1
result: not_run

## Verification
- [ ] `pnpm type-check`: not run by proof-generate
- [ ] `pnpm test`: not run by proof-generate

## Runtime Verification
- Generated foundation artifact. Replace or append command output when runtime proof is executed.

## SHA Binding
Head SHA: fb07846a4404bddd954d4011ffa85c4356e561e8
Merge SHA: e5634c9878b185bb18965b182a70f97cfa6258d1

## Verification commands (executed)

- `pnpm verify` — green on branch head 3dd67b09 via required CI check `verify` (SUCCESS) on PR #1007; merge SHA e5634c9878b185bb18965b182a70f97cfa6258d1 merged on green.
- `scripts/ci/r-level-check.ts` — R-Level Compliance Check ✓ PASSED on PR #1007 (all required R-level artifacts present).
- `pnpm test:db` — 7/7 pass against live Supabase from the lane worktree (see verification.md).
