# PROOF: UTV2-1838 diff summary

MERGE_SHA: pending merge
Execution SHA: 80b955acd77a721a1c52f825342cc384c1011e3d

## Summary

Seven files. Three repairs to closeout idempotency, plus the reserved
carry-forward review packet and a measured `plan.md` reconciliation.

```
 .../CARRY_FORWARD_MERGE_GATE_INTEGRATION.md        | 136 ++++++++++
 .../proposals/carry-forward-merge-gate.patch       | 288 +++++++++++++++++++++
 docs/mission/plan.md                               | 179 ++++++++++---
 scripts/ops/lane-close.test.ts                     |  50 ++++
 scripts/ops/lane-close.ts                          | 104 ++++++++
 scripts/ops/lane-finalize.test.ts                  |   6 +-
 scripts/ops/lane-finalize.ts                       |   9 +-
 scripts/ops/t2-proof-bundle.test.ts                |  98 +++++++
 scripts/ops/t2-proof-bundle.ts                     |  56 +++-
 9 files changed, 885 insertions(+), 41 deletions(-)
```

## Changed files

| File | Change |
|---|---|
| `scripts/ops/t2-proof-bundle.ts` | `isMarkdownProofPath` overwrite guard, refused before the `force` check, reported in a new `refused_paths` field; `readOptionalFile` tolerates an absent path and resolves against the caller's root |
| `scripts/ops/t2-proof-bundle.test.ts` | inversion test asserting a `.json` sidecar's bytes survive `--force`; refusal without `force`; `isMarkdownProofPath` cases; `readOptionalFile` absent/present/root |
| `scripts/ops/lane-finalize.ts` | `--verification-log` names `verification.md`, the file `ops:proof-generate` actually writes |
| `scripts/ops/lane-finalize.test.ts` | the plan assertion follows, with the reason recorded inline |
| `scripts/ops/lane-close.ts` | `guardCloseAgainstMainCheckout` + `close_refused_on_main_checkout` code and remediation; `rebindRepairedLaneProof` calls both evidence harvesters |
| `scripts/ops/lane-close.test.ts` | guard refuses on `main`, permits a lane worktree and trusted automation; remediation is actionable |
| `docs/05_operations/CARRY_FORWARD_MERGE_GATE_INTEGRATION.md` + `proposals/carry-forward-merge-gate.patch` | the reserved merge-authority integration, prepared and verified, **not applied** |
| `docs/mission/plan.md` | closeout-repeatability record incl. the two deferred scope items; Command Center deployment correction; re-measured release delta; PR board; three Learned entries |

## Not in this diff, and why

`truth-check-lib.ts` (history append on infra-error) and `lease-registry.ts`
(terminal-lane lease reclaim) are scope items 5 and 6 of the issue. Both are
outside this lane's `file_scope_lock`, which is pinned at lane-start and cannot
be widened by an agent. They are recorded in `docs/mission/plan.md` under
"Closeout repeatability" rather than taken through an override.

No workflow file is touched. `verify`, `Executor Result Validation`,
`Merge Gate` and `P0 Protocol` are unchanged.
