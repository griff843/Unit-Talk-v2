# PROOF: UTV2-1923

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T18:45:00.000Z
Issue: UTV2-1923
Tier: T1
Lane type: runtime
Branch: claude/utv2-1923-human-capper-official-picks-delivery
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1592
Head SHA: 7bba38a2cd5f6582c52facb1e673468678661f22
result: pass

## ASSERTIONS:

The lane claims one product transaction, built and inert. Each box is an
assertion a named test makes; none is a restatement of intent.

- [x] An authorized human capper's submission is pinned `delivery-eligible` by the SERVER, from an allow-list the request cannot reach, and is delivered IMMEDIATELY: `validated → queued` and exactly one outbox row on `discord:official-picks`, in one transaction, with no operator step.
- [x] The delivered row carries the authenticated submitting capper as `picks.capper_id`.
- [x] The delivery is routed to THAT capper's own picks-only destination, resolved server-side from `cappers.metadata.discord.picksChannelId` on the canonical `cappers` row. No channel id is hard-coded; routing is per capper, not per deployment.
- [x] The capper's discussion / Capper Space destination appears nowhere on the delivered row. A record whose `picksChannelId` equals its `discussionChannelId` is refused before either id is returned, so the discussion destination has no path to delivery at all.
- [x] A capper with NO mapping delivers nowhere: `destination-refused:capper-row-missing`, zero outbox rows, and the pick stays `validated` — not parked in `awaiting_approval`.
- [x] A MALFORMED mapping fails closed by name rather than being treated as valid configuration — nine shapes, including the exact production shape today (`metadata` present but `{}`), a channel NAME, a `<#…>` mention, a non-object `discord` block, and a guild this deployment does not serve.
- [x] The mapping is refused when it points at the private global `DISCORD_CAPPER_CHANNEL_ID`.
- [x] The browser/client can neither supply nor override the destination: a `deliveryDestination` in the request body is not read, and the pinned value is the server-resolved one.
- [x] A duplicate submission resolves to the same pick and creates no second delivery — still exactly one outbox row.
- [x] An unauthorized capper is still pinned Track Only, and every pre-existing Track Only chokepoint still refuses.
- [x] A client-supplied `deliveryAuthorization` record is destroyed before anything reads it, on every source — not only the capper path.
- [x] A capper requesting `distributionMode: 'delivery-eligible'` is refused `403 CAPPER_TRACK_ONLY_REQUIRED`.
- [x] Operator approval is reserved for AUTONOMOUS producers: `model-driven`, `board-construction`, `system-pick-scanner` and `alert-agent` are still braked into `awaiting_approval` with zero outbox rows, and the human ingress is not. Asserted mechanically via `requiresOperatorApprovalBeforeDelivery` and `humanCapperDeliveryRequiresOperatorApproval` (`false`), which live beside `GOVERNANCE_BRAKE_SOURCES`.
- [x] With the target disabled — the shipped posture — an authorized submission FAILS CLOSED: `delivery-refused` with reason `target-disabled`, zero outbox rows, and the pick stays `validated`. It is NOT parked in `awaiting_approval`; a refusing control is never a request for approval.
- [x] Approval remains a RECOVERY door for a human pick an operator has deliberately parked: it releases exactly one row on `discord:official-picks` when the target is released, enqueues nothing and says `target-disabled` when it is not, and denial voids the pick.
- [x] `official-picks` participates in the target registry, worker target coverage, the delivery kill switch and the operator kill-switch route; it ships `enabled: false` and holds no kill-switch row, so it is killed twice over.
- [x] An authorized human pick cannot be delivered to any board target, despite the `promotion_target` the scoring lane stamps on it at submission.
- [x] Requeue refuses a human capper pick outright (`409 HUMAN_DELIVERY_REQUEUE_BLOCKED`), so it cannot become a second delivery path.
- [x] A manually settled human pick settles, and its immediate per-pick recap is gated by the live kill switch — the recap posts by direct `fetch`, outside the outbox, so the worker's check never sees it.
- [x] The SCHEDULED aggregate recap honours the same delivery stop as the immediate per-pick recap, so a stop engaged after delivery cannot be undone by the next morning's daily/weekly/monthly publication.
- [x] The `human-capper` deploy mode releases the worker and nothing else; `parked` remains byte-identical; the mode is unreachable from the syndicate-machine secret.
- [x] A `discord:<channelId>` delivery is now subject to the kill switch, and a raw channel is still not refused by the registry it can never appear in.
- [x] No model/board delivery target changed its shipped posture.
- [x] The worker reads the pinned destination and, for a human delivery carrying none, REFUSES rather than falling back to the shared target map.
- [x] `deploy.yml` refuses a shared `discord:official-picks` entry in `UNIT_TALK_DISCORD_TARGET_MAP` outright, in both the canary and production blocks. The previous assertion REQUIRED that entry; under per-capper routing it is the one misconfiguration that could converge every capper's picks on one channel, so the assertion is inverted.
- [x] Every guard above has a mutation control that removes it and demonstrates the failure it prevents — including the destination guard, whose mutant enqueues a delivery with no destination and falls back to the shared mapping.

## EVIDENCE:

Measured on `7bba38a2cd5f6582c52facb1e673468678661f22`, in the lane worktree.

```
$ pnpm type-check
(no output)
exit=0

$ pnpm test
5880 `ok` lines, 0 `not ok` lines across every package.
exit=0

$ pnpm lint
(no output)
exit=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 31
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
# tests 44   # pass 44   # fail 0        (includes 7 mutation controls)

$ pnpm exec tsx --test apps/worker/src/delivery-adapters.test.ts
# tests 7    # pass 7    # fail 0        (3 new: the pinned destination beats a
                                          present shared map entry; a human target
                                          with no pin refuses; a malformed pin is
                                          not a destination)

$ pnpm exec tsx --test apps/api/src/capper-delivery-authorization.test.ts
# tests 12   # pass 12   # fail 0

$ pnpm exec tsx --test apps/api/src/recap-service.test.ts
# tests 27   # pass 27   # fail 0        (scheduled aggregate recap stop)

$ pnpm exec tsx --test scripts/ci/deploy-parked-mode.test.ts
# tests 32   # pass 32   # fail 0        (incl. the inverted shared-map rule)

$ pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts
# tests 70   # pass 70   # fail 0        (4 new kill-switch tests)

$ pnpm exec tsx --test apps/api/src/distribution-service.test.ts
# tests 35   # pass 35   # fail 0

$ pnpm exec tsx --test apps/api/src/controllers/review-pick-controller.test.ts
# tests 18   # pass 18   # fail 0        (the recovery door, unchanged)

$ pnpm exec tsx --test apps/api/src/controllers/submit-pick-controller.test.ts
# tests 13   # pass 13   # fail 0
```

## Verification
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm lint`: exit 0, no output
- [x] `pnpm test`: exit 0, 5880 `ok` / 0 `not ok` across the whole suite
- [ ] `pnpm verify`: cannot run locally — `ci:assert-staging` refuses outside the `staging-ci` environment; the authoritative run is the `verify` check on PR #1592
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS (31 changed files, `lifecycle-fsm` matched; the one missing artifact is PM-gated advisory)

## Runtime Verification

**What this lane's runtime proof can and cannot be, stated plainly.**

The lane now claims two things, and they need different evidence. The positive
claim — an authorized capper's submission creates exactly one governed delivery,
with no operator step — is exercised end to end against real repositories. The
negative claim is the one that matters for containment: as SHIPPED, that path
cannot fire, because the target is disabled in the registry and killed by the
absence of a kill-switch row. Both are exercised here against real repositories
and the real deploy script:

- the server-side authorization path, the immediate release transaction, the
  approval recovery door, the enqueue chokepoints and the recap gate run end to
  end against the in-memory repository bundle — the same code paths the database
  bundle implements;
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

**The Discord destinations were identified by read-only enumeration, not inferred
from names.** The enumeration ran inside the already-authorized
`unit-talk-discord-bot-1` container against the live guild, read the bot token
only from that container's own environment, and printed names, ids, types and
parents only — no secret value was emitted, nothing was created, renamed or
modified. The capper destinations are forum THREADS (type 11) inside the
`👑・cappers-space` forum, one `Official Picks` thread and one
`Q&A & Discussion` thread per capper. The exact ids are in the PM hand-off; they
are deliberately NOT written into source, into this bundle's code paths, or into
production `cappers.metadata`, which remains unwritten pending PM review.

`runtime-health.json` in this bundle records the measured posture of every
control as shipped, including the destination-routing block.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1592
Approved PR head: pending merge
Execution SHA: 7bba38a2cd5f6582c52facb1e673468678661f22
