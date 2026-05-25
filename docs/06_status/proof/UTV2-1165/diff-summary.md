# UTV2-1165 — Diff Summary

Merged on main as `cf9ac4f73abac79816e5886afc8d676667129a07`.

**Issue:** UTV2-1165 · 7–8 Lane Trial Governor  
**Tier:** T2  
**Branch:** claude/utv2-1165-7-8-trial-governor  

## Changes

### `docs/governance/CONCURRENCY_CONFIG.json`
- Bumped `version` from 1 → 2
- Added `trial` block with `enabled`, `total`, `executors`, `allowed_until`, `rationale`, `safe_types_only` fields
- Trial defaults: `enabled: false`, `total: 8`, `executors: {claude: 3, codex: 5}`, `allowed_until: null`

### `scripts/ops/concurrency-config.ts`
- Added `TrialConfig` interface (trial block shape)
- Added `EffectiveConcurrencyConfig` interface (resolved limit set)
- Made `trial` optional on `ConcurrencyConfig`
- Added `getEffectiveConfig(config, now?)` — returns trial limits when trial is active and within expiry; auto-reverts to base limits when expired

### Mechanical consumers
- `scripts/ops/lane-start.ts` now calls `getEffectiveConfig(loadConcurrencyConfig())` before enforcing limits
- `scripts/ops/execution-state.ts` now reports dispatch slots from effective limits
- `scripts/ops/merge-risk.ts` now detects saturation from effective limits
- `scripts/ops/lane-maximizer.ts` now defaults candidate planning limits from effective limits
- `ops:lane-start` rejects unsafe lane types when filling slots above the base 6-lane ceiling during a trial

### `docs/governance/LANE_CONCURRENCY_POLICY.md`
- Added §11 "Trial governor (7–8 lane ceiling)" documenting the mechanism, safe-types constraint, auto-revert behavior, and audit trail requirements

### `scripts/ops/concurrency-simulation.test.ts`
- Added import for `getEffectiveConfig`
- Added 9 new test cases (§11 trial governor scenarios):
  - Trial disabled → base limits returned
  - Trial enabled with future expiry → trial limits returned
  - Trial expired → auto-revert to base limits
  - Trial with null `allowed_until` → never expires
  - 7th lane allowed under trial
  - 9th lane blocked even under trial
  - Expired trial blocks at 7 (reverts to base 6 cap)
  - Unsafe lane types cannot fill above-base trial slots

## No-touch invariants

- `checkConcurrencyLimits` still enforces singleton types and forbidden combinations, and now also enforces trial safe-type restrictions for above-base slots
- Base limits (6/2/4) are unchanged in the config
- Trial is disabled by default (`enabled: false`)
- Singleton types and forbidden combinations are unchanged
