# PROOF: UTV2-1923

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T03:13:36.000Z
Issue: UTV2-1923
Tier: T1
Lane type: runtime
Branch: claude/utv2-1923-human-capper-official-picks-delivery
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1592
Head SHA: 4e125c78e9721298f738b477ad4240a463f93758
result: pass

## ASSERTIONS:

The lane claims one product transaction, built and inert. Each box is an
assertion a named test makes; none is a restatement of intent.

- [x] An authorized human capper's submission is pinned `delivery-eligible` by the SERVER, from an allow-list the request cannot reach, and parks in `awaiting_approval` with zero outbox rows.
- [x] An unauthorized capper is still pinned Track Only, and every pre-existing Track Only chokepoint still refuses.
- [x] A client-supplied `deliveryAuthorization` record is destroyed before anything reads it, on every source — not only the capper path.
- [x] A capper requesting `distributionMode: 'delivery-eligible'` is refused `403 CAPPER_TRACK_ONLY_REQUIRED`.
- [x] Operator approval performs the `awaiting_approval → queued` transition and the outbox write as one transaction, and is the ONLY path out of the brake.
- [x] With the target disabled — the shipped posture — approval enqueues nothing and says why (`target-disabled`).
- [x] With the target released, approval enqueues exactly one row, on `discord:official-picks`, auditable with both the approver and the capper.
- [x] `official-picks` participates in the target registry, worker target coverage, the delivery kill switch and the operator kill-switch route; it ships `enabled: false` and holds no kill-switch row, so it is killed twice over.
- [x] An authorized human pick cannot be delivered to any board target, despite the `promotion_target` the scoring lane stamps on it at submission.
- [x] Requeue refuses a human capper pick outright (`409 HUMAN_DELIVERY_REQUEUE_BLOCKED`).
- [x] A manually settled human pick settles, and its immediate per-pick recap is gated by the live kill switch — the recap posts by direct `fetch`, outside the outbox, so the worker's check never sees it.
- [x] The SCHEDULED aggregate recap honours the same delivery stop as the immediate per-pick recap, so a stop engaged after delivery cannot be undone by the next morning's daily/weekly/monthly publication.
- [x] The `human-capper` deploy mode releases the worker and nothing else; `parked` remains byte-identical; the mode is unreachable from the syndicate-machine secret.
- [x] A `discord:<channelId>` delivery is now subject to the kill switch, and a raw channel is still not refused by the registry it can never appear in.
- [x] No model/board delivery target changed its shipped posture.
- [x] Every guard above has a mutation control that removes it and demonstrates the failure it prevents.

## EVIDENCE:

Measured on `4e125c78e9721298f738b477ad4240a463f93758`, in the lane worktree.

```
$ pnpm type-check
(no output)
exit=0

$ pnpm test
5867 `ok` lines, 0 `not ok` lines across every package.
(tail, the last file in the run — the new T1 proof:)
1..31
# tests 31
# pass 31
# fail 0
exit=0

$ pnpm lint
(no output)
exit=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 27
Rules matched: lifecycle-fsm

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
exit=0

$ pnpm verify
REFUSED locally: `ci:assert-staging` refuses to run outside the `staging-ci`
GitHub environment, by design. `pnpm verify` therefore cannot exit 0 on a
developer machine, and its authoritative run is the `verify` check on this PR.
```

Per-file detail for the new coverage:

```
$ pnpm exec tsx --test apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts
# tests 31   # pass 31   # fail 0        (includes 6 mutation controls)

$ pnpm exec tsx --test apps/api/src/capper-delivery-authorization.test.ts
# tests 12   # pass 12   # fail 0

$ pnpm exec tsx --test apps/api/src/recap-service.test.ts
# tests 27   # pass 27   # fail 0        (scheduled aggregate recap stop)

$ pnpm exec tsx --test scripts/ci/deploy-parked-mode.test.ts
# tests 32   # pass 32   # fail 0        (7 new, incl. `parked` unchanged)

$ pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts
# tests 70   # pass 70   # fail 0        (4 new kill-switch tests)
```

## Verification
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test`: exit 0, 0 failing assertions across the whole suite
- [ ] `pnpm verify`: cannot run locally — `ci:assert-staging` refuses outside the `staging-ci` environment; the authoritative run is the `verify` check on PR #1592
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS (27 changed files, `lifecycle-fsm` matched; the one missing artifact is PM-gated advisory)

## Runtime Verification

**What this lane's runtime proof can and cannot be, stated plainly.**

The behaviour under test is a *refusal*: the claim is that a delivery path
exists and cannot fire. Every control that makes it not fire is exercised here
against real repositories and the real deploy script:

- the two-key authorization path, the brake, the approval transaction, the
  enqueue chokepoints and the recap gate run end to end against the in-memory
  repository bundle — the same code paths the database bundle implements;
- the worker's registry and kill-switch checks run through `runWorkerCycles`
  with a real `InMemoryDeliveryKillSwitchRepository`, whose `isKilled` is the
  same fail-closed contract the database repository implements;
- the deploy mode is asserted against the actual `deploy.yml` source, parsed,
  in both the canary and production blocks.

**Read-only production measurement was performed**, 2026-09-17, against
`zfzdnfwdarxucxtaojxm`. It writes nothing and changes no containment setting:
`delivery_kill_switch` holds 4 rows and `official-picks` is not one of them;
`distribution_outbox` holds 0 rows on `discord:official-picks`; 0 picks carry
`promotion_target = 'official-picks'`; and 0 picks carry a
`metadata.deliveryAuthorization` record. The exact counts are in
`evidence.json` under `runtime_proof.row_counts`.

**A live-DB WRITE run against production is deliberately NOT performed.** It would
require creating a `delivery_kill_switch` row for `official-picks` — a
production write whose only effect would be to *weaken* the fail-closed default
this lane depends on. The absence of that row is the control. The staging
live-DB receipt is produced by the `verify` check and the `Writable DB proof
(staging only)` check on PR #1592, which run in the `staging-ci` environment
against the staging project, not production.

`runtime-health.json` in this bundle records the measured posture of every
control as shipped.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1592
Approved PR head: pending merge
Execution SHA: 4e125c78e9721298f738b477ad4240a463f93758
