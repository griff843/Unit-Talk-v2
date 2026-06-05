<!-- merge_sha: placeholder-update-after-merge -->
## Verification

### pnpm verify (full pipeline)

```text
pnpm verify — PASS (exit code 0)
ops:sync-check + env:check + lint + type-check + build + test all passed
```

### Tests (6/6 pass)

```text
npx tsx --test packages/db/src/team-schedule-repository.test.ts
# tests 6
# suites 1
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Test cases:
1. Returns most recent completed game date before `beforeDate`
2. Returns null when no prior game exists
3. Returns null when repo is empty
4. Filters by status: only `completed` and `in_progress` qualify
5. Ignores games for other teams
6. Correct result when team appears in multi-team events

### R-level compliance

```text
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
Changed files: 2
```

### Tier

T2 — bounded runtime change to `packages/db/src/runtime-repositories.ts`.
No DB schema changes. No migration. No contracts modified.
InMemory + Database implementations, pure query logic.

### File scope

- `packages/db/src/runtime-repositories.ts`
- `packages/db/src/team-schedule-repository.test.ts`
- `docs/06_status/proof/UTV2-1221/`
