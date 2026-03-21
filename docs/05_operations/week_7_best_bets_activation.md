# Week 7 Best Bets Activation

## Objective

Activate real `discord:best-bets` safely while retaining `discord:canary`.

## Preconditions

- Week 6 runtime lane complete
- promotion persistence live
- routing gate live
- promotion tests passing
- CI enforcing `pnpm test` and `pnpm test:db`
- governance artifacts current
- canary healthy at activation time

## Activation Steps

1. Change `UNIT_TALK_DISCORD_TARGET_MAP` so `discord:best-bets` points to the real Best Bets channel ID `1288613037539852329`.
2. Keep `UNIT_TALK_DISTRIBUTION_TARGETS=discord:canary,discord:best-bets`.
3. Select one controlled pick that is already `promotion_status = qualified` and `promotion_target = best-bets`.
4. Send the first real-channel post through the normal worker path.
5. Capture the proof bundle.
6. Check operator state before, during, and after the post.

## Proof Bundle

- submission ID
- pick ID
- promotion score
- promotion reason
- promotion status
- promotion target
- promotion history ID
- outbox ID
- outbox status
- receipt ID
- Discord message ID
- target channel ID
- run ID
- audit action IDs
- operator snapshot timestamp
- worker health
- canary health

## Success Criterion

Week 7 is complete only when one qualified pick is successfully posted to the real Best Bets channel, receipt/audit/operator evidence is captured, canary remains healthy, and no rollback triggers fire.

## Rollback Conditions

- any `discord:best-bets` outbox row enters `failed`
- any `discord:best-bets` outbox row enters `dead_letter`
- repeated delivery failures
- degraded worker state
- growing pending backlog
- canary degradation

## Rollback Action

1. Remove `discord:best-bets` from live routing by reverting its target map or removing it from `UNIT_TALK_DISTRIBUTION_TARGETS`.
2. Keep `discord:canary` active.
3. Preserve outbox, receipt, run, and audit rows for investigation.
4. Record the failure evidence in status docs and the active tracking issue.

## Acceptance Criteria

- one real qualified Best Bets post succeeds
- receipt recorded
- operator view clean
- canary still healthy
- no unauthorized or non-qualified routing observed

## Non-goals

- no new channels
- no strategy-room rollout
- no game-thread rollout
- no intelligence expansion
- no settlement implementation
- no operator-web polish unrelated to activation

## Owner

- Activation execution owner: Codex runtime lane
- Channel-switch approval owner: user
