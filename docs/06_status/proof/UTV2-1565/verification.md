# UTV2-1565 Runtime Verification

Generated at: 2026-07-20T23:55:16.555Z
Issue: UTV2-1565
Tier: T2
Lane type: hygiene
Branch: claude/utv2-1565-ghost-lane-reconciliation
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1274
Head SHA: 0394d860b5ba4415258e46d2546663b4f53e154d
Merge SHA: 263468a737061e162d07610f33bfdd6d6af6808e
result: not_run

## Verification
- [ ] `pnpm type-check`: not run by proof-generate
- [ ] `pnpm test`: not run by proof-generate
- [ ] `pnpm verify`: not run by proof-generate
- [ ] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: not run by proof-generate

## Runtime Verification
- Generated foundation artifact. Replace or append command output when runtime proof is executed.

## SHA Binding
Head SHA: 0394d860b5ba4415258e46d2546663b4f53e154d
Merge SHA: 263468a737061e162d07610f33bfdd6d6af6808e

## Live-DB proof (T2 docs-only lane, no runtime/DB code touched)

This lane's proof directories are audited by `pnpm exec tsx scripts/ops/proof-auditor-gate.ts --require-executed-command "pnpm test:db"`, which applies unconditionally to every changed proof directory regardless of tier. `pnpm test:db` was run against live Supabase solely to satisfy this gate.

```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

# PROOF: UTV2-1565

MERGE_SHA: 263468a737061e162d07610f33bfdd6d6af6808e

## ASSERTIONS:
- [x] Lane manifest reaches status: done with a real closed_at
- [x] pnpm ops:truth-check passes for UTV2-1565

## EVIDENCE:
See the lane-close and truth-check output embedded above in this file.
