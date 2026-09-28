# PROOF: WORK-2026092814

MERGE_SHA: pending merge

Issue: WORK-2026092814
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092814-bot-truthful-copy
Head SHA: dd7994f2aea4b51b53027b2a035f0f66b097561a
result: pass

## ASSERTIONS:

- [x] `/trial-status` and `/upgrade` describe VIP by what it has today (official capper picks,
      recaps, results, capper board) and VIP+ as everything in VIP with its market-intelligence
      features "not live yet". For every tier (free, trial, vip, vip-plus) neither embed contains
      "Best Bets", "Trader Insights" or "permanently".
- [x] `/heat-signal`'s description and empty state say line-movement alerts are not live yet;
      `/help` matches.
- [x] `/recap`: a pick with a null `clvPercent` renders `CLV: unavailable`, not `CLV: —`. A pick with
      CLV still renders its value (`CLV: +3.8%`).
- [x] `/stats`: with at least 5 picks and `picksWithClv === 0`, a `CLV` field reads
      `unavailable (no closing-line data)`. With CLV data it does not appear, and the existing
      "Avg CLV% (vs SGO close)" field does.
- [x] Scope: `apps/discord-bot/**` plus this lane's work order, manifest and proof. No API, DB,
      worker, delivery, containment or kill-switch change, and no production write. Tier names and
      prices are unchanged.

## EVIDENCE:

### Tests

```
$ pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts
# tests 103
# pass 103
# fail 0
```

Four cases were added, and the existing `/heat-signal` empty-state assertion was updated to the new text.

### Mutation drill

Each changed source file was restored from its pre-lane version in turn, and the test file re-run:

```
revert trial-status -> # fail 1
revert upgrade -> # fail 1
revert heat-signal -> # fail 2
revert recap -> # fail 1
revert stats -> # fail 1
```

With every file restored to the lane version, all 103 pass.

## Verification

- [x] `pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts`: 103 pass, 0 fail
- [x] `tsc -p apps/discord-bot --noEmit`: exit 0
- [x] eslint on `apps/discord-bot/src`: exit 0
- [x] Mutation drill: reverting any one of the five source files turns at least one test red
- [x] `pnpm verify:commands`: the regenerated Discord command manifest (`apps/discord-bot/command-manifest.json`) matches the command definitions; migration version and lint checks pass
- [x] `pnpm verify` runs in the required CI `verify` context on this PR's head, which carries the implementation commits b897fed48cc3fc0184f6c9f2e55e3c9f91bcb162 and dd7994f2aea4b51b53027b2a035f0f66b097561a unchanged. The Merge Gate requires it to be green before merge.
- [x] `pnpm type-check` and `pnpm test` are included in that `pnpm verify` run.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base cc9e5a1826453c779c6593b3f2f2961b6f9d886f --head dd7994f2aea4b51b53027b2a035f0f66b097561a`: Verdict PASS, 14 changed files, rule matched `discord-delivery`.

## Runtime Verification

This lane is T2 and changes only the bot's user-facing text. It adds no read or write path. It reaches
members only through a deploy, which is reserved to Griff.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1688
Execution SHA: dd7994f2aea4b51b53027b2a035f0f66b097561a
