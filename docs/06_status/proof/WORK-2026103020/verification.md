# PROOF: WORK-2026103020

MERGE_SHA: pending merge

ASSERTIONS:

- [x] Settled At uses the effective settlement, including an older correction; lifecycle remains unchanged.
- [x] Pending, manual-review and missing/invalid effective times remain unknown, with no fallback to an obsolete pick-row time.
- [x] The page reuses its existing correction-chain read; no extra query, authentication change or write is added.

EVIDENCE:

Actual restored focused TAP summary from /tmp/work3020-restored.log:

```text
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

CI run 41117136479 attempt 2 passed verify and staging at prior proof head 3298d572fe5aa988144cca6cd4f0667d81a70bef. This checklist/fence-only repair leaves source unchanged and requires fresh exact-head CI before executor handoff.

The rebindable anchor above intentionally remains pending before merge. Execution identity is the verified source SHA below; supported closeout will bind the actual merge SHA.

## Verification

Source: `286ecb3bc20a1433bd3b7e353dbc69a359b82d07`.

- Direct `pnpm exec tsx --test apps/command-center/src/lib/data/pick-identity.test.ts`: 9 passed, 0 failed.
- `pnpm --filter @unit-talk/command-center type-check`: PASS.
- `pnpm build`: PASS. The first app-suite attempt preceded workspace dependency compilation and failed on missing generated dist entries; building the supported worktree resolved that setup issue.
- Final `pnpm --filter @unit-talk/command-center test`: 741 passed, 0 failed.
- `pnpm verify`: all static stages passed; full command exited 1 only at the writable staging-target guard, which refused the loopback target. No local writable DB test or green full gate is claimed. Exact-head CI staging proof is required. Genuine command output retained at /tmp/work3020-verify.log.
- Repository-wide `pnpm type-check` and `pnpm test` were executed by `pnpm verify`, in addition to the app checks above; both passed before the writable staging guard. These are actual executed commands recorded in /tmp/work3020-verify.log.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, operator-ui; rerun on the bound lane head before this proof repair.
- R-level: PASS, operator-ui. `git diff --check`: PASS.
- Generated next-env.d.ts change from the local Next server was restored; it is not part of this fix.
- CI QA Experience Regression (Advisory), run 41112997928: failed only at posting its PR comment with `Resource not accessible by integration`. This advisory authorization failure is recorded rather than treated as a product or browser acceptance failure; no workflow scope expansion was made.
- Local `evaluateCloseEligibilityPreflight` after section/anchor and exact-command references: eligible true, zero blocking findings. Proof-only repair leaves product source unchanged and requires fresh exact-head CI after the queue permits its push.

## Required mutation

Temporarily changed the identity projection from `settledAt: string(current.settled_at)` to `settledAt: string(pick.settled_at)`. The direct focused command exited 1 and failed Track Only, older correction, and pending/manual-review/missing-time behavior cases. A finally block restored exact source bytes. Restored command exited 0 with all 9 tests passing. Logs: /tmp/work3020-mutant.log and /tmp/work3020-restored.log. No mutant was committed.

## Browser proof

Actual Next page from this source ran on loopback port 14320, authenticated normally using an isolated fixture account. The separate fixture HTTP server on 15434 supplies synthetic persisted reads and refuses POSTs. This is genuine browser interaction with synthetic data, not production persistence or deployed acceptance. See qa-experience-report.md and capture files.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1812

## Provenance

Session-reported gpt-6.1-sol; reasoning effort unavailable, external session unverified. No routing override or PM approval is claimed. Claude owns CI queue coordination, main refresh, review/integration, merge and closeout.
