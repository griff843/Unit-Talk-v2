<!-- merge_sha: placeholder-update-after-merge -->
## Verification

### pnpm verify (full pipeline)

```text
pnpm verify — PASS (exit code 0)
env:check + lint + type-check + build + test all passed
```

### Implementation

Added to `packages/domain/src/features/player-form.ts`:
- `player_id?: string` field on `GameLog` interface (optional, for fixture/pipeline use)
- `reference_date?: string` and `max_age_hours?: number` fields on `PlayerFormConfig`
- 72h max-age guard at start of `extractPlayerFormFeatures`: filters logs older than `max_age_hours` (default 72) before `reference_date`; returns `ok: false` fail-closed if insufficient fresh logs remain

### Tests (13 pass, 0 fail)

```text
npx tsx --test packages/domain/src/features/player-form.test.ts
# tests 13
# suites 2
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

New tests in `72h max-age guard (mock fixture pipeline)` describe block:
1. Accepts fresh fixture logs (within 72h) — non-null output
2. Rejects all-stale logs (age > 72h) — fail closed, `ok: false`
3. Fails when insufficient fresh logs remain after filtering
4. Uses only fresh logs when mix of stale and fresh exceeds min_games
5. Skips max-age guard when `reference_date` not provided
6. `player_id` field preserved on mock fixture entries

### pnpm test:db (7/7 pass)

```text
pnpm test:db
# tests 7
# pass 7
# fail 0
```

### Type-check

```text
pnpm type-check — PASS (exit code 0)
```

### R-level

```text
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```
