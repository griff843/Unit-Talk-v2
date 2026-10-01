---
name: betting-domain
description: Guard pure betting-domain and cross-package contract changes. Use for packages/contracts or packages/domain and their CanonicalPick, scoring, grading, or lifecycle rules.
category: implementation
owner: codex
trigger: Touching packages/contracts, packages/domain, or pure CanonicalPick/scoring/grading/lifecycle policy.
---

# Betting Domain

Use this before changing scoring, lifecycle rules, contracts, or pure domain logic.
Do not load it for app-only persistence or delivery changes that consume the
domain contract without modifying it.

## Invariants

- `@unit-talk/domain` stays pure: no DB, HTTP, env, logging, or app imports
- contracts are defined in `@unit-talk/contracts` first
- apps pass data into domain; apps do not own thresholds or scoring policy
- missing data fails closed, never defaults to qualified

## Always check

- score components come from `pick.metadata.promotionScores`
- lifecycle edges still match the repo state machine
- approval and promotion remain separate concepts

## Required verification

```bash
pnpm type-check
pnpm test
```

Import audit:
```bash
rg "@unit-talk/db|@unit-talk/config|apps/" packages/domain/src
```

Any hit in `packages/domain/src` is a red flag and must be explained or fixed.

## Reference

For the full shared team version, read:
- [`.claude/commands/betting-domain.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/betting-domain.md)
