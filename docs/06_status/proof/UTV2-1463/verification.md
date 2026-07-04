# PROOF: UTV2-1463 Verification

Issue: UTV2-1463
Tier: T2
Branch: codex/utv2-1463-closeout-concurrency-hardening
MERGE_SHA: b68c2c5568320a5ae3efcc06e007bd90e1d8fbbf

Squash-merge SHA on main (implementation commits 79a063c6, d2150e5d merged via PR #1149).

## ASSERTIONS:

- [x] `post-merge-lane-close.yml` job is bounded by `timeout-minutes: 30` so a hung closeout cannot hold `merge-closeout-mutex` indefinitely
- [x] On `ops:lane-close` failure, the workflow releases the same-issue/branch merge mutex (no `--force`, does not mask the red closeout)
- [x] Bookkeeping `git push` now rebases and retries up to 3 attempts when main advances mid-closeout, instead of failing non-fast-forward and stranding the lane in `merged` state
- [x] Existing failure semantics preserved: blocking PR comment still posted, workflow still exits red on closeout failure
- [x] Workflow YAML parses clean; guard suites green

## EVIDENCE:

Commands run 2026-07-04 from the lane worktree.

```text
node -e "YAML.parse(fs.readFileSync('.github/workflows/post-merge-lane-close.yml','utf8'))"
→ workflow yaml parse ok

pnpm exec tsx --test scripts/ops/lane-close.test.ts scripts/ops/workflow-hardening.test.ts
# tests 83
# pass 83
# fail 0
# skipped 0

pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)
pnpm test → PASS (root aggregate suite)
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
→ Verdict: PASS; no R1-R5 rules matched (workflow + proof paths only)
```

## Verify blocker (environmental, out of scope)

`pnpm verify` fails only in `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` — a live-data precondition asserting SGO ingestion within a 72h window. The SGO API key has been inactive at the vendor since 2026-06-30 12:41 UTC (zero ingestion since), so the assertion fails for every branch. All static steps (lint, type-check, build, test) pass, and `pnpm test:db` passed 7/7 before the live-proof step. This lane changes only `.github/workflows/post-merge-lane-close.yml` and its proof files; the failure is not caused by, and cannot be repaired within, this lane's scope.
