# UTV2-1501 proof

MERGE_SHA: 1674924fc3b09bb53f5fbca45834113d4be048dd

## Verification

| Field | Result |
|---|---|
| Implementation head | `ac0f6f537f1e77822f9c8226450b3fe92b7db988` |
| `pnpm verify` | PASS |
| `pnpm test:db` | PASS — 7 tests, 0 failures |
| Live T1 proof | PASS — one expected stale-provider skip, 0 failures |
| R-level check | PASS — no rules matched and no R-level artifacts required |
| Runtime behavior changed | No |
| Constitution or workflow changed | No |
| Independent owner approval | Not supplied; still required for this T1 PR |

The proof is pre-merge and binds the immutable implementation commit above.
The final merge SHA does not yet exist and must be added by the governed
post-merge truth-close flow. Executor-produced proof is not a substitute for
`t1-approved` or a valid Griff `pm-verdict/v1`.

`pnpm test:db` execution summary:

```text
# tests 7
# pass 7
# fail 0
# skipped 0
```

## Post-merge truth-close (ghost-lane repair)

PR #1230 merged to `main` as `1674924fc3b09bb53f5fbca45834113d4be048dd` at
`2026-07-17T12:43:44Z`, but `docs/06_status/lanes/UTV2-1501.json` was never
updated to `status: "done"` afterward -- it sat at `status: "started"`,
occupying an active Claude dispatch slot and counting against the
governance-lane-type concurrency cap, with no runtime effect from the
merged content itself (this lane changed only governance decision-packet
documentation, no code/runtime/migration).

Reconciled via `pnpm ops:lane-close UTV2-1501 --repair-merged` (binds
`status`/`commit_sha` to the actual GitHub merge state), followed by a
plain `pnpm ops:lane-close UTV2-1501` to reach `status: "done"` with a real
`closed_at` from the governed close event. This repair PR touches only the
lane manifest and this proof bundle -- no new implementation content.

# PROOF: UTV2-1501

MERGE_SHA: 1674924fc3b09bb53f5fbca45834113d4be048dd

This is the real GitHub squash-merge commit SHA on `main` for PR #1230
(confirmed present on `origin/main`, reachable via `git merge-base
--is-ancestor`). This repair PR reconciles the lane manifest and proof
bundle to that authoritative merge SHA; it introduces no new implementation
content.

ASSERTIONS:
- [x] Lane manifest `commit_sha` and `status` rebound to the actual merge SHA; `status` reaches `done` with `closed_at` populated from the real `pnpm ops:lane-close UTV2-1501` close event
- [x] `pnpm verify` passed on the original implementation commit per PR #1230's own CI history
- [x] `pnpm test:db` passed 7/7 (TAP output above) as part of the original T1 proof
- [x] R-level check passed, no rules matched
- [x] No implementation, workflow, runtime, deploy, secret, or GitHub App content is introduced by this repair PR -- it is lane-manifest and proof-bundle reconciliation only
- [x] No new owner approval is claimed by this repair; PR #1230's original `t1-approved`/`pm-verdict/v1` approval remains the binding owner action for the implementation itself

EVIDENCE:

```text
$ pnpm test:db (from original PR #1230 T1 proof, reproduced above)
# tests 7
# pass 7
# fail 0
# skipped 0
```
