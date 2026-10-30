# PROOF: WORK-2026103020

MERGE_SHA: pending merge

## Verification

Source: `286ecb3bc20a1433bd3b7e353dbc69a359b82d07`.

- Direct `pnpm exec tsx --test apps/command-center/src/lib/data/pick-identity.test.ts`: 9 passed, 0 failed.
- `pnpm --filter @unit-talk/command-center type-check`: PASS.
- `pnpm build`: PASS. The first app-suite attempt preceded workspace dependency compilation and failed on missing generated dist entries; building the supported worktree resolved that setup issue.
- Final `pnpm --filter @unit-talk/command-center test`: 741 passed, 0 failed.
- `pnpm verify`: running; final result not yet claimed.
- R-level: PASS, operator-ui. `git diff --check`: PASS.
- Generated next-env.d.ts change from the local Next server was restored; it is not part of this fix.

## Required mutation

Temporarily changed the identity projection from `settledAt: string(current.settled_at)` to `settledAt: string(pick.settled_at)`. The direct focused command exited 1 and failed Track Only, older correction, and pending/manual-review/missing-time behavior cases. A finally block restored exact source bytes. Restored command exited 0 with all 9 tests passing. Logs: /tmp/work3020-mutant.log and /tmp/work3020-restored.log. No mutant was committed.

## Browser proof

Actual Next page from this source ran on loopback port 14320, authenticated normally using an isolated fixture account. The separate fixture HTTP server on 15434 supplies synthetic persisted reads and refuses POSTs. This is genuine browser interaction with synthetic data, not production persistence or deployed acceptance. See qa-experience-report.md and capture files.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending creation after staging queue permits it

## Provenance

Session-reported gpt-6.1-sol; reasoning effort unavailable, external session unverified. No routing override or PM approval is claimed. Claude owns CI queue coordination, main refresh, review/integration, merge and closeout.
