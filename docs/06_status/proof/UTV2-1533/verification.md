# Verification — UTV2-1533

**Issue:** UTV2-1533 — Post-lock concurrency ramp: raise ceiling to 10 active lanes (4 Claude + 6 Codex)
**Tier:** T1 (governance-critical config/docs change; no runtime, DB, or pick-pipeline code touched)

## Verification

## R-level check

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

No R1–R5 rule paths matched the changed files (`docs/governance/CONCURRENCY_CONFIG.json`, `docs/governance/LANE_CONCURRENCY_POLICY.md`, `scripts/ops/concurrency-simulation.test.ts`). No mandatory artifacts triggered.

## Targeted test

```
$ npx tsx --test scripts/ops/concurrency-simulation.test.ts
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All 23 subtests pass, including the fixed assertion (`total===10`, `claude===4`, `codex===6`) and the trial-mode tests, which use an independent local `POLICY` fixture unaffected by this change.

## Runtime confirmation (execution-state)

```
$ pnpm exec tsx scripts/ops/execution-state.ts --json
...
"dispatch_slots": {
  "claude": { "used": 1, "max": 4, "available": 3 },
  "codex":  { "used": 0, "max": 6, "available": 6 }
}
```

Confirms `getEffectiveConfig()` picks up the new base limits from the working-tree config with no other code changes required.

## pnpm test:db / runtime proof

**Not applicable to this lane.** This change touches only `docs/governance/CONCURRENCY_CONFIG.json` (a policy JSON with no DB/runtime code path), `docs/governance/LANE_CONCURRENCY_POLICY.md` (documentation), and `scripts/ops/concurrency-simulation.test.ts` (an ops-tooling unit test with an in-memory fixture, no Supabase connection). The R-level check above independently confirms no rule requiring `pnpm test:db` or a runtime evidence bundle was triggered by this diff. `pnpm test:db` was not run for this lane; this is not a claim of execution.

## Full verify

`pnpm verify` run on this branch; see `docs/06_status/proof/UTV2-1533/evidence.json` / PR CI checks for the full log (env-check, lint, type-check, build, test).

## Commit SHA reference

Branch HEAD commit at time of verification: `c608a2e11b6bfa128b93745fb4988c476ba1f3cd`.

## Merge SHA reference

To be appended after merge via `ops:proof-generate --merge-sha` (automated, `post-merge-lane-close.yml`).
