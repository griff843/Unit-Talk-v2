# Codex Spec: UTV2-1385 — Automate promotion_target_check sync between TypeScript and Postgres (DEBT-017)

## Issue
UTV2-1385: The `promotionTargets` array in `packages/contracts/src/promotion.ts` and the `picks_promotion_target_check` Postgres constraint in `supabase/migrations/00000000000000_baseline_live_schema.sql` can drift out of sync silently. This adds a CI check that fails if they diverge.

## Branch
`codex/utv2-1385-promotion-target-check-sync`

## Tier
T2

## Context
- `promotionTargets` lives in `packages/contracts/src/promotion.ts` (lines 3–7):
  ```ts
  export const promotionTargets = [
    'best-bets',
    'trader-insights',
    'exclusive-insights',
  ] as const;
  ```
- The Postgres constraint is in `supabase/migrations/00000000000000_baseline_live_schema.sql` (line ~2979):
  ```sql
  CONSTRAINT picks_promotion_target_check CHECK (((promotion_target IS NULL) OR (promotion_target = ANY (ARRAY['best-bets'::text, 'trader-insights'::text, 'exclusive-insights'::text]))))
  ```
- These two lists must stay in sync. Right now there is no automated check.

## Scope — write only these files

- `scripts/ci/check-promotion-target-sync.ts` (NEW — primary deliverable)
- `scripts/ci/check-promotion-target-sync.test.ts` (NEW — test that imports and exercises the check)

**Do NOT touch any other files.** No new GHA workflow files. No changes to `packages/`, `apps/`, `supabase/migrations/`, `.claude/hooks/`, or `tsconfig.json`.

## Deliverables

### 1. `scripts/ci/check-promotion-target-sync.ts`

A standalone script that:
1. Reads `promotionTargets` from `packages/contracts/src/promotion.ts` using a static import via relative path from the scripts dir.
2. Parses the `promotion_target_check` constraint values out of `supabase/migrations/00000000000000_baseline_live_schema.sql` using a regex that extracts the `ARRAY[...]` values.
3. Compares the two sets (order-insensitive).
4. Exits 0 if they match; exits 1 with a clear diff message if they do not.
5. Exports a `checkSync()` function that returns `{ ok: boolean; tsValues: string[]; sqlValues: string[]; missing: string[]; extra: string[] }` so the test file can call it.

The SQL file path should be relative to the repo root (use `path.resolve()` with `fileURLToPath(import.meta.url)` as the anchor for ESM-compatible path resolution).

### 2. `scripts/ci/check-promotion-target-sync.test.ts`

A `node:test` test file that:
- Imports `checkSync` from `./check-promotion-target-sync.ts`
- Asserts that the current values are in sync (`ok === true`)
- Does NOT mock the file reads — runs against real files
- Uses the standard `node:test` + `node:assert/strict` pattern used throughout this repo

The test must be discoverable by `pnpm test` (which runs `tsx --test` on `**/*.test.ts` globs). No new test runner config needed.

## Pre-PR steps (required before opening PR)

1. `pnpm verify` — must exit 0 (run from the worktree root)
2. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — paste output in PR body under `## R-level compliance`
3. Open PR: `gh pr create --title "chore(ci): UTV2-1385 automate promotion_target_check sync between TS and Postgres"`
4. PR body must include: `Closes UTV2-1385`, `## R-level compliance` section, `## Merge order` section
5. After PR opens: `gh pr edit <PR-number> --add-label "tier:T2"`

## Merge order (for PR body)

| Lane | Issue | Files touched | Must merge after |
|---|---|---|---|
| Codex | UTV2-1385 | `scripts/ci/check-promotion-target-sync.ts`, `scripts/ci/check-promotion-target-sync.test.ts` | none (independent) |

## Do NOT
- Create or modify any `.github/workflows/` files (singleton path, will cause scope_bleed CI failure)
- Touch `packages/contracts/src/promotion.ts`
- Touch `supabase/migrations/00000000000000_baseline_live_schema.sql`
- Add the check to an existing pnpm verify step — the test file handles CI integration
- Create any other files outside the allowed scope above
