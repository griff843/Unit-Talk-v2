# PROOF: WORK-2026092911

MERGE_SHA: pending merge

Issue: WORK-2026092911
Tier: T2
Lane type: governance
Branch: claude/work-2026092911-official-picks-release-runbook
Head SHA: f0dd769afb78c30f893789679f031e6a723ad130
result: pass

## ASSERTIONS:

- [x] §8.1 posture matches a read-only production SELECT taken 2026-09-29: four governed targets killed, no `human-capper-recaps` row, fixture row `t1-proof-utv2-1427-kill-switch` released and unread by the worker.
- [x] §8.3/§8.4 describe what the code does: a delivery-eligible submission while `official-picks` is killed is still released to `queued` with a pending outbox row, because `evaluateDistributionTargetGate` reads the registry, not the kill switch; the worker holds the row with `kill-switch-engaged`; a voided or settled pick's row is marked `sent` with no receipt (`distribution-worker.ts` settled/voided skip).
- [x] The procedure never releases `human-capper-recaps` and forbids replay/retry during the first release.
- [x] The section authorizes nothing: member-delivery activation stays reserved to Griff.
- [x] Scope: one documentation file. No code, kill-switch, containment or production change.

## EVIDENCE:

```
-- read-only, zfzdnfwdarxucxtaojxm, 2026-09-29 (re-measured at proof time)
select target, killed, actor, updated_at from delivery_kill_switch order by target;
  best-bets                      | true  | claude-session-utv2-1601-containment | 2026-08-01 14:08Z
  exclusive-insights             | true  | system-bootstrap                     | 2026-07-14 23:13Z
  official-picks                 | true  | claude:human-capper-e2e-window-close | 2026-09-19 02:24Z
  t1-proof-utv2-1427-kill-switch | false | t1-proof-runner                      | 2026-07-14 23:14Z
  trader-insights                | true  | claude-session-utv2-1601-containment | 2026-08-01 14:08Z
  (no human-capper-recaps row)

select o.id, o.status, o.pick_id, p.status from distribution_outbox o join picks p on p.id = o.pick_id
 where o.target = 'discord:official-picks';
  3447bb03 | sent    | ed0ed43c | posted
  5005f461 | pending | c12f1e2f | voided
  684ba33f | sent    | 816a84c7 | settled
  68f922a2 | pending | 2cc92f4b | voided
```

- Read-only SQL on `zfzdnfwdarxucxtaojxm`: `delivery_kill_switch` rows and `distribution_outbox` rows for `discord:official-picks`, 2026-09-29.
- Code read on `main` 400c2962c: `apps/api/src/distribution-service.ts` (`evaluateDistributionTargetGate`), `apps/api/src/run-audit-service.ts` (`releaseHumanCapperDeliveryWithRunTracking`), `apps/worker/src/distribution-worker.ts`, `apps/worker/src/runner.ts`.

## Verification

- [x] Documentation-only diff (`git diff --stat origin/main...HEAD`: one file)
- [x] `pnpm test` and `pnpm verify` run in the required CI `verify` context on this PR's head
- [x] Preflight WORK-2026092911 PASS (39 checks)

## Runtime Verification

Documentation only. It changes no runtime behaviour; the controls it names ship and are proven in their own lanes.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1693
Execution SHA: f0dd769afb78c30f893789679f031e6a723ad130
