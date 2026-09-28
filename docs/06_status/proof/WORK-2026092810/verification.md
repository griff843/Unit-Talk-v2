# PROOF: WORK-2026092810

MERGE_SHA: pending merge

Issue: WORK-2026092810
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092810-member-tier-gate
Head SHA: 1c9b256546ae9b2804360eda13a492ed4d9eb7cb
result: pass

## ASSERTIONS:

- [x] `requireActivePickRoles(config)` (`apps/discord-bot/src/role-guard.ts`) returns Trial (only
      when configured), VIP, VIP+, Capper and Operator (only when configured). It never returns an
      empty list, which the router would read as unrestricted.
- [x] `/live` and `/today` declare `requiredRoles` from that helper. The existing router role
      guard refuses a member holding none of them before `deferReply` and before any picks read.
- [x] `/results` remains ungated (MEMBERSHIP_PRODUCT_CONTRACT.md §3.3 grants Free settled results).
- [x] Scope: 4 files, all under `apps/discord-bot/src/`. No API, DB, delivery, containment or
      kill-switch change, and no production write.

## EVIDENCE:

### Tests

```
$ pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts
# tests 99
# pass 99
# fail 0
```

Eight cases were added:

- the helper, with full config, with Trial and Operator unconfigured, and with empty config;
- for `/live` and `/today`: a Free member is refused and the API is never called;
- for `/live` and `/today`: a VIP member is admitted;
- the registry built from env gates `/live` and `/today`, but not `/results`.

### Mutation drill

Removing `requiredRoles` from `createLiveCommand` turned 2 of the new tests red (the Free refusal
for `/live` and the registry wiring). With the file restored, all 99 pass.

## Verification

- [x] `pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts`: 99 pass, 0 fail
- [x] `tsc -p apps/discord-bot --noEmit`: exit 0
- [x] eslint on the four changed files: exit 0
- [x] Mutation drill: removing the `/live` gate turns 2 tests red
- [x] `pnpm verify` passed in the required CI `verify` context on head `c9c4c75320906edabd5d4b09fc5fe352814e6ed9`, which carries this lane's implementation unchanged.
- [x] `pnpm type-check` is included in that `pnpm verify` run and passed.
- [x] `pnpm test` is included in that `pnpm verify` run and passed.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base 3b071d9d6514cc9943a4e875371940337f38b600 --head 4a694a0b968bf25f1a31fe0c2f4a2d6f7dc90a0b`: Verdict PASS, 9 changed files, rule matched `discord-delivery`.

## Runtime Verification

This lane is T2 and changes only the bot's access gate. It adds no read or write path. It reaches
members only through a deploy, which is reserved to Griff.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1683
Execution SHA: 1c9b256546ae9b2804360eda13a492ed4d9eb7cb
