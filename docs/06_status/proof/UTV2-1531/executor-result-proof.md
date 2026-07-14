# PROOF: UTV2-1531
MERGE_SHA: c47c23fac1e631973dcd1d19ec2042f4b5abcc20

ASSERTIONS:
- [x] validateFileScopeEntry() and matchesLockPattern() agree on allowed glob/bracket syntax — PASS (trailing `/**` directory locks and literal `[id]` bracketed routes both accepted; unsupported glob syntax `*?{}` outside a trailing `/**` still rejected)
- [x] file-scope-guard excludes docs/06_status/lanes/parked/** from active cross-lane conflict detection — PASS (`resolveTrustedManifests` filters parked paths before building the trusted manifest set)
- [x] Regression tests cover both fixes — PASS (56 tests passing: `npx tsx --test scripts/ops/shared.test.ts scripts/ci/file-scope-guard.test.ts`)
- [x] No behavior change to legitimate glob rejection or non-parked conflict detection — PASS (existing rejection/conflict tests unmodified and still passing)

EVIDENCE:
```text
npx tsx --test scripts/ops/shared.test.ts scripts/ci/file-scope-guard.test.ts
  56 tests passed, 0 failed

pnpm type-check
  PASS — TypeScript project-references check completed

pnpm test
  PASS — root aggregate test suite completed

pnpm verify
  PASS — full repository gate completed, including static checks and live-DB smoke tests

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS
  Changed files: 10
  Rules matched: (none) — no R-level artifacts required for this diff
```

NOTES:
Scripts/ops-tooling only (scripts/ops/shared.ts, scripts/ci/file-scope-guard.ts and their
test files); no application runtime, database, domain, contract, migration, or delivery
path touched. Fixes KNOWN_DEBT.md DEBT-030 (glob/bracket file-scope validation mismatch)
and DEBT-031 (parked manifests counted as active conflicts), both discovered live during
OS v1 Lock stabilization and reproduced on the merged UTV2-1522/PR #1190 post-merge
closeout.
