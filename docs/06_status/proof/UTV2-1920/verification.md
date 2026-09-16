# PROOF: UTV2-1920

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-16T09:10:46.929Z
Issue: UTV2-1920
Tier: T1
Lane type: governance
Branch: claude/utv2-1920-contracts-utf8-repair
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1588
Head SHA: 967aa113efdfece7f0eed0a347ee11350655ce31
result: pass

## ASSERTIONS:

- [x] `packages/contracts/src/picks.ts` decodes as valid UTF-8 — `iconv -f UTF-8 -t UTF-8` exits 0 where it previously reported `illegal input sequence at position 410`.
- [x] The exact CI job that failed — the `apps/command-center` Next.js build — completes on this head.
- [x] The only byte changed is the lone `0x97` (CP1252 em dash) becoming a UTF-8 em dash `E2 80 94`. One line, no semantic change.
- [x] A regression guard exists that fails on this defect class, and it is reachable from the root `test:ops` script without a root `package.json` edit.
- [x] The guard cannot pass vacuously: it asserts the probe rejects a lone `0x97` and accepts a UTF-8 em dash before sweeping, and asserts the tracked file list is non-trivial.
- [x] The guard is mutation-proven: reintroducing the byte turns the suite red naming the offending file.
- [x] No containment surface is touched — no `deploy.yml`, compose, `.env`, entrypoint or kill-switch path, zero migrations.

## EVIDENCE:

Measured on head `967aa113efdfece7f0eed0a347ee11350655ce31` in the lane worktree.

```
$ iconv -f UTF-8 -t UTF-8 packages/contracts/src/picks.ts
(exit 0 — clean; on main this reported: iconv: illegal input sequence at position 410)

$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm test
# tests 6367
# pass  6367
# fail  0
exit 0

$ pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
ok 20 - every tracked app and package source file decodes as valid UTF-8
# tests 20
# pass  20
# fail  0
exit 0

$ NEXTAUTH_SECRET=placeholder-build-secret pnpm --filter "@unit-talk/command-center..." build
apps/command-center build: ƒ Middleware                             35.5 kB
apps/command-center build: ○  (Static)   prerendered as static content
apps/command-center build: ƒ  (Dynamic)  server-rendered on demand
apps/command-center build: Done
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
exit 0

$ pnpm verify
not runnable on this host — ci:assert-staging-target refuses a workstation with no staging
credential. Its execution site is the required `verify` check on this PR, and the live-DB
half is the `Writable DB proof (staging only)` job, per this lane's
t1_live_db_precondition: deferred_to_ci.
```

The inversion that makes the guard meaningful, run separately (the byte reintroduced, then restored):

```
not ok 20 - every tracked app and package source file decodes as valid UTF-8
  packages/contracts/src/picks.ts: The encoded data was not valid for encoding utf-8
# pass 19
# fail 1
```

The failure this repairs, from `Deploy` run 35075808951:

```
apps/command-center build: ../../packages/contracts/src/picks.ts
apps/command-center build: Caused by:
apps/command-center build:     0: Failed to read source code from /repo/packages/contracts/src/picks.ts
apps/command-center build:     1: stream did not contain valid UTF-8
apps/command-center build: > Build failed because of webpack errors
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 6367 tests, 6367 pass, 0 fail
- [ ] `pnpm verify`: not runnable locally (staging-target assertion); executed by the required `verify` check on this PR
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required

## Runtime Verification

The runtime boundary for this defect is a Next.js build, because SWC — not `tsc` and not
esbuild — is the compiler that refuses a non-UTF-8 source stream. That boundary was exercised
directly: `NEXTAUTH_SECRET=placeholder-build-secret pnpm --filter "@unit-talk/command-center..." build`
completes with a full route table and `Done` on this head, and the same command's CI equivalent
failed on `main` at `Deploy` run 35075808951. The inversion is measured on the real job rather
than asserted.

The live-DB half of T1 runtime proof is deferred to CI under this lane's
`t1_live_db_precondition: deferred_to_ci`, and is supplied by the `Writable DB proof
(staging only)` job on the merge SHA. It is not fabricated here.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1588
Approved PR head: pending merge
Execution SHA: 967aa113efdfece7f0eed0a347ee11350655ce31
