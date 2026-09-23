# PROOF: UTV2-1929 Diff Summary

MERGE_SHA: 7731c80d083fd44760b042c647b31092c5ea6d9a

Generated at: 2026-09-18T07:20:00.000Z
Issue: UTV2-1929
Tier: T2
Lane type: runtime
Branch: claude/utv2-1929-human-capper-lifecycle-repairs
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1601
Head SHA: 1794657ff10f614e79c2c80bf09f7d3cd71b39ff
Execution SHA: 1794657ff10f614e79c2c80bf09f7d3cd71b39ff
Diff base: ab6837871f164553eda0fb6b7c41519b0c9e42a3
result: pass

## Git Diff Stat

```
 .github/workflows/deploy.yml              |  34 +++++++
 apps/api/src/grading-service.test.ts      | 143 ++++++++++++++++++++++++++++++
 apps/api/src/grading-service.ts           |  34 +++++++
 apps/worker/src/delivery-adapters.test.ts |  38 +++++++-
 apps/worker/src/delivery-adapters.ts      |  25 +++++-
 apps/worker/src/worker-runtime.test.ts    |   9 +-
 6 files changed, 276 insertions(+), 7 deletions(-)
```

## What changed, and why

Two production defects, both measured on 2026-09-18 while proving the post-delivery lifecycle
for the accepted Human Capper delivery canary (pick `816a84c7-58b8-4585-8e7a-7ad1e036342e`).
Neither activates anything and neither weakens a fail-closed control.

### 1. A human capper pick could never receive its settlement recap

Settling the delivered canary through the intended operator payload returned:

```
"humanCapperRecap": { "posted": false, "reason": "no_receipt_channel_or_resolvable_outbox_target" }
```

`resolveRecapChannel` (`apps/api/src/grading-service.ts`) resolved the recap channel from the
`sent` outbox row's receipt: first `normalizeDiscordChannelId(receipt.channel)`, otherwise
`normalizeDiscordChannelId(outbox.target)`. `normalizeDiscordChannelId` strips a `discord:`
prefix, requires a numeric id, and otherwise falls back to `UNIT_TALK_DISCORD_TARGET_MAP`.

The production row:

| outbox | target | receipt.channel | payload.channelId | external_id |
|---|---|---|---|---|
| `684ba33f-45c4-4a80-adf0-db8286c90815` | `discord:official-picks` | `discord:official-picks` | `1384052464189440120` | `1550376792987140208` |

`official-picks` is not numeric, and UTV2-1923 **deliberately** exempted human delivery targets
from the shared target map — a human capper's official pick routes per capper from the pin the
server writes onto the outbox row. So neither branch could ever resolve, for any human capper
pick, ever.

Root cause is in the writer: `apps/worker/src/delivery-adapters.ts` recorded
`channel: outbox.target` on the `discord.message` receipt, discarding `route.channelId` — the
channel it actually POSTed to. The receipt recorded the request, not the delivery.

**Fixed on both sides:**

- The worker now records `route.channelId` on the receipt at the two sites where a route exists
  (the `sent` receipt and the HTTP-error receipt). The logical target is not lost: it stays on
  `payload.target`, and `idempotencyKey` still keys on `outbox.target`, so no row can be resent.
  The catch-block receipt (no route was resolved) and the dry-run receipt still carry the target,
  because there is no resolved destination to record.
- `resolveRecapChannel` reads the adapter's `payload.channelId` **first**. Every
  `discord.message` receipt already written carries it, so the recap is repaired for existing
  rows without backfilling delivery history to fix a reader. The read is strict — a non-numeric
  value is not a destination and falls through to the existing refusal.

`resolveRecapChannel` is the only consumer that treats `receipt.channel` as a Discord channel id;
`apps/command-center/src/lib/data/snapshot.ts` only groups `worker.rollout-skip` receipts.

### 2. Every Command Center write to the API answered 401

The API resolves its operator key set from its own env (`apps/api/src/auth.ts`,
`loadAuthConfig`). `deploy.yml` loads `UNIT_TALK_CC_API_KEY` into the step env and writes it only
into `.env.command-center`. Measured on the production host: **no `.env.production` this workflow
has ever written contains that name** — the API's only registered keys are
`UNIT_TALK_BOT_API_KEY` (submitter) and `UNIT_TALK_INGESTOR_API_KEY` (settler).

So the Command Center presented a bearer the API had never registered, and every Command Center
write — settle, review, retry-delivery, requeue, kill switch — returned 401. This is the actual
blocker behind Milestone 2 condition 5; it is not `UNIT_TALK_COMMAND_CENTER_ENABLED`, which is
already `true` with `unit-talk-command-center-1` running healthy.

`deploy.yml` now writes the same secret into `.env.production` at both `.env.production` write
sites. The rationale is carried as a YAML comment on the step's `env:` mapping, **not** as a `#`
line inside the backslash-continued `printf` argument list — a `#` there is an argument, and
would have written a junk line into the production env file.

## ASSERTIONS:

- [x] A `discord.message` receipt records the channel the adapter actually POSTed to, not the
      logical target. Asserted by `UTV2-1929: the receipt records the pinned channel, not the
      logical target` (`apps/worker/src/delivery-adapters.test.ts`).
- [x] The logical target is not lost: `payload.target` still carries it and `idempotencyKey` is
      still keyed on it, so delivery identity and replay protection are unchanged. Same test.
- [x] The settlement recap resolves the pinned channel from an existing production-shaped
      receipt payload. Asserted by `UTV2-1929: the settlement recap resolves the pinned channel
      from the receipt payload` (`apps/api/src/grading-service.test.ts`), which seeds the exact
      production row shape and requires the POST to reach
      `https://discord.com/api/v10/channels/1384052464189440120/messages`.
- [x] The payload read is strict and fails closed. Asserted by `UTV2-1929: a non-numeric payload
      channelId is not a destination`, which requires `fetch` never to be called.
- [x] `.env.production` now carries `UNIT_TALK_CC_API_KEY` at both write sites, so the API
      registers the Command Center's operator bearer. Verified by reading both `printf` blocks
      and by `yaml.safe_load` on the whole workflow.
- [x] No containment flag, kill switch, delivery posture or approval path is touched by this
      diff. `SYNDICATE_MACHINE_MODE`, `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED`,
      `_worker_autorun` and `_enabled_targets` do not appear in the change.

## EVIDENCE:

```
$ npx tsx --test apps/worker/src/delivery-adapters.test.ts
# tests 8
# pass 8
# fail 0

$ npx tsx --test apps/worker/src/worker-runtime.test.ts
# tests 72
# pass 72
# fail 0

$ npx tsx --test apps/api/src/grading-service.test.ts
# tests 94
# pass 94
# fail 0

$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
[exited with code 0]
```

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: lifecycle-fsm
Advisory missing artifacts: r4-fault-report [PM-gated]
```

## Merge SHA Binding

Merge SHA: `7731c80d083fd44760b042c647b31092c5ea6d9a`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1601
