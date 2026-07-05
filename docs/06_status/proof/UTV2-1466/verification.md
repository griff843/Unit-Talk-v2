# PROOF: UTV2-1466 Verification

Issue: UTV2-1466
Tier: T2
Branch: codex/utv2-1466-shared-pnpm-store-isolated-install-relax
MERGE_SHA: 8af54b2679b0f78fc233a51524bb3e2248e2271c

Squash-merge SHA on main (implementation commit 408959cb merged via PR #1153).

## ASSERTIONS:

- [x] Lane installs use the shared warm pnpm store: `buildPnpmStateEnv` no longer sets `NPM_CONFIG_STORE_DIR`/`npm_config_store_dir`, while `PNPM_HOME`, `COREPACK_HOME`, cache, and state stay lane-local (per-worktree `node_modules` isolation intact)
- [x] Measured warm-store install: a fresh detached worktree completed `pnpm install --frozen-lockfile --prefer-offline` in **12.5 s** (`WARM_INSTALL_SECONDS=12.53`, "Done in 11.2s" per pnpm) — well under the 1-minute acceptance bar vs the 1–3+ min cold-store baseline
- [x] `lane-maximizer` no longer blocks package-touching candidates solely because any active lane exists (`ISOLATED_INSTALL_REQUIRED` any-active-lane rule removed); genuine conflicts still block via the file-scope overlap check (package.json / pnpm-lock.yaml overlap), singleton lane types, forbidden combinations, migration, and Tier C risk handling
- [x] `scripts/ops/lane-maximizer.test.ts` updated: 25/25 pass, covering the relaxed recommendation and the shared-store env shape
- [x] `pnpm type-check` and root `pnpm test` pass; `lane-execution.test.ts` 12/12 confirms unchanged isolated-install helper behavior

## Verification

Executed 2026-07-04 from the lane worktree; raw output in EVIDENCE below.

- `pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts` — PASS (25/25)
- `npx tsx --test scripts/ops/lane-execution.test.ts` — PASS (12/12)
- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS (ops-script diff, no rules matched)
- Warm-store install timing in a fresh worktree — 12.5 s

## EVIDENCE:

```text
pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts
# tests 25
# pass 25
# fail 0
# skipped 0

pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)
pnpm test → PASS (root aggregate suite)

Fresh detached worktree, lane-local home/corepack/cache/state, shared default store:
pnpm install --frozen-lockfile --prefer-offline
→ Done in 11.2s using pnpm v10.29.3
→ WARM_INSTALL_SECONDS=12.53
```

## Verify blocker (environmental, out of scope)

`pnpm verify` fails only in `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` — a live-data precondition asserting SGO ingestion within a 72h window. Read-only DB check confirms the latest live `provider_offer_history` row is `2026-06-30T12:41Z` (the moment the SGO key went inactive at the vendor), older than the 72h window — the assumption is false before this lane's code is involved. All static verify steps pass; `pnpm test:db` passed before the live-proof step.
