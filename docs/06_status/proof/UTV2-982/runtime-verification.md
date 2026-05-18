# Runtime Verification — UTV2-982

## Pre-merge Verification

### Pre-merge checklist

- [ ] `pnpm verify` green on branch
- [ ] All 5 new T1 proof tests pass against live Supabase
- [ ] Zero `discord:qa-pick-delivery` pending rows in production DB
- [ ] `audit_log` has entries for each quarantined row
- [ ] R-level compliance: `tsx scripts/ci/r-level-check.ts` PASS
- [ ] Tier label `tier:T1` applied to PR
- [ ] `pnpm test:db` output pasted in PR body

---

## Behavioral Change Description

### Before this PR

- `evaluateDistributionTargetGate` returned `{ ok: true }` for any target where `parsePromotionTargetFromDeliveryTarget` returned null, silently allowing unknown non-promotion targets like `discord:qa-pick-delivery`
- `handleQaSeedPick` called `outbox.enqueue()` directly, bypassing all distribution-service validation
- Result: rows stranded indefinitely — worker never polled `discord:qa-pick-delivery`

### After this PR

- `evaluateDistributionTargetGate` throws `UnsupportedDeliveryTargetError` for any non-promotion target that is not `discord:canary` or `discord:<numericChannelId>`
- `handleQaSeedPick` calls `enqueueDistributionWork()` with `discord:${channelId}` format — numeric channel ID passes the gate; in local env `resolveDeliveryTarget` redirects to `discord:canary`
- Existing 6 stranded rows dead-lettered with full audit evidence per PM disposition

---

## Live-DB Proof Output

```
UTV2-982: quarantined 6 stranded discord:qa-pick-delivery rows
✔ UTV2-982: quarantine all discord:qa-pick-delivery pending rows with audit evidence (2006.8386ms)
✔ UTV2-982: zero discord:qa-pick-delivery pending rows remain after cleanup (97.4295ms)
✔ UTV2-982: evaluateDistributionTargetGate throws UnsupportedDeliveryTargetError for discord:qa-pick-delivery (0.6362ms)
✔ UTV2-982: discord:canary passes the gate (0.1397ms)
✔ UTV2-982: discord:<numericId> passes the gate (QA seed new target format) (0.1463ms)
ℹ tests 5 pass 5 fail 0 duration_ms 3011.5725
```

---

## Invariant Audit

| Invariant | Status |
|-----------|--------|
| No silent fallback to unsupported target | ✓ `UnsupportedDeliveryTargetError` throws |
| Every mutated live row has audit evidence | ✓ `audit_log` written per row |
| QA seed uses validated enqueue path | ✓ `enqueueDistributionWork` called |
| Worker can claim QA seed rows | ✓ routes to `discord:canary` in local env |
| No new pending rows for unsupported targets | ✓ fail-closed gate prevents future stranding |
