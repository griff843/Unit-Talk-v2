# PROOF: UTV2-1960

MERGE_SHA: pending merge

Issue: UTV2-1960
Tier: T2
result: pass

## ASSERTIONS:

- [x] `/trial-status` and `/upgrade` promise only the live VIP surfaces and mark future VIP+ intelligence as not live.
- [x] `/heat-signal`, `/help`, and the command manifest say line-movement alerts are not live.
- [x] `/recap` renders missing CLV as `unavailable` while retaining real CLV values.
- [x] `/stats` renders absent closing-line data as unavailable and does not attribute valid CLV to an SGO close.
- [x] The five-source mutation drill proves each adopted behavior is protected by a failing regression assertion when reverted.
- [x] PR #1688 / WORK-2026092814 is recorded as predecessor provenance; its terminal head is `7053dc9b4947aa5a3d103e373e96d4a3d430a216`, the PR is closed, and its lease is released.

## EVIDENCE:

Execution SHA: `51bde4530b90ecfe3905132e881b6f6df06e6b97`

Focused suite:

```text
tests 103
pass 103
fail 0
```

Mutation drill:

```text
MUTATION_KILLED_trial-status
MUTATION_KILLED_upgrade
MUTATION_KILLED_heat-signal
MUTATION_KILLED_recap
MUTATION_KILLED_stats
```

R-level compliance:

```text
Verdict: PASS
Changed files: 12
Rules matched: discord-delivery
```

## Verification

- `pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts` — PASS, 103/103.
- `pnpm --filter @unit-talk/discord-bot type-check` — PASS.
- `pnpm --filter @unit-talk/discord-bot command-manifest:check` — PASS, 14 definitions.
- `pnpm verify` — the complete `verify:static` phase passed, including lint, root type-check, build, full unit suite, Smart Form verification, command-manifest verification, and migration lint. The subsequent `test:live-db` phase was truthfully refused by `ci:assert-staging` because the local URL identifies `127.0.0.1`, not sanctioned staging `xskgrzbteyqdufktjrjx`. This T2 lane touches no DB/API service path.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; `discord-delivery` matched, R1 required, no artifact requirement.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 51bde4530b90ecfe3905132e881b6f6df06e6b97
