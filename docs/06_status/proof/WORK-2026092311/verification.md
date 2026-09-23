# PROOF: WORK-2026092311

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-23T20:58:30.000Z
Issue: WORK-2026092311
Tier: T2
Lane type: governance
Branch: claude/work-2026092311-tripwire-verdict
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1639
Head SHA: 273256ce0f8203641c85968ded853b0696beac1f
Execution SHA: 273256ce0f8203641c85968ded853b0696beac1f
Diff base: df071f24b11d9988f830a6ee56bec6b2c03a31db
result: pass

## ASSERTIONS:

- [x] `probeDbTripwires` (`scripts/ops/readiness-refresh.ts`) scores a red
      `db-health-tripwire.yml` run `fail` when its only failed step is
      `Report DB health verdict` (`DB_TRIPWIRE_VERDICT_STEP`). The evidence names the step and
      `measured.failed_steps` records it.
- [x] Every other red shape stays `unknown`, exactly as before. That includes the 2026-07-30
      exit-127 harness failure (`Run DB health checks`), a failed connection-URL step, the
      verdict step failing alongside another step, and no reported failed step.
- [x] A test reads `.github/workflows/db-health-tripwire.yml` and pins three things: the step's
      exact name, its position after the harness and proof steps, and the absence of an `if:`.
      Those are the conditions under which "only the verdict step failed" means "checks ran and
      tripped".
- [x] No threshold changes, and no path can move the dimension toward `pass`.
- [x] Scope: `readiness-refresh.ts` and its test. No workflow, production write, migration,
      deploy, delivery or containment change.

## EVIDENCE:

### 1. Live read against the GitHub API

The probe was called with the real `createGithubReader()` from a scratch runner that was deleted
afterwards:

```
status: fail
evidence: db-health-tripwire.yml run https://github.com/griff843/Unit-Talk-v2/actions/runs/35918291130
  executed its checks and failed only at "Report DB health verdict" at 2026-09-23T20:47:59Z
  (0.1h ago): at least one tripwire fired.
measured.failed_steps: ["Report DB health verdict"]
```

The six most recent runs have two shapes:

```
35883573778 35848637817 35809621873   Run: success  Prove: success  Report: failure   -> now fail
35781399382 35750322594 35716311278   Run: failure  Prove: failure  Report: skipped   -> still unknown
```

### 2. Mutation drill

Each mutation was applied alone and then restored from a copy:

```
M1 drop the new branch                 not ok 24 - a run that failed only at the verdict step is a measured tripwire failure, not unknown
M2 includes() instead of "only"        not ok 25 - the verdict step failing alongside another step stays unknown
M3 add 'if: always()' to the step      not ok 26 - the verdict step exists in db-health-tripwire.yml, unconditioned, after the harness and proof steps
M4 rename the workflow step            not ok 26 - the verdict step exists in db-health-tripwire.yml, unconditioned, after the harness and proof steps
restored                               # fail 0
```

### 3. Tests

```
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts
# tests 40
# pass 40
# fail 0

$ pnpm test
tests 6846, pass 6846, fail 0 (zero 'not ok' TAP lines across the workspace)
```

### R-level

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head 273256ce0f8203641c85968ded853b0696beac1f
Verdict: PASS
Rules matched: (none)
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm exec eslint` on the 2 changed files: exit 0
- [x] `pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts`: 40 pass, 0 fail
- [x] `pnpm test`: 6846 pass, 0 fail
- [x] `ops:preflight`: PASS, 38 checks
- [x] Mutation drill: each of the 4 mutations turns its named test red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout, because
      `ci:assert-staging` refuses a loopback `SUPABASE_URL`. CI runs `verify` on the PR.

## Runtime Verification

T2. The ledger generator changes only how it classifies a GitHub run. The live read above is
the runtime observation. The next scheduled `readiness-refresh.yml` run will record
`db_tripwires` as `fail` with a measured reason, instead of `unknown`. The dimension was
already blocking and red; it stays red.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1639
Approved PR head: pending merge
Execution SHA: 273256ce0f8203641c85968ded853b0696beac1f
