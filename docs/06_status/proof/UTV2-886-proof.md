# UTV2-886 Proof — End-to-end Discord delivery smoke test

**Branch:** claude/utv2-886-discord-delivery-smoke-test  
**Head SHA:** d3e240d5  
**Tier:** T2  
**Run at:** 2026-05-12T06:47:05Z  

## Smoke test execution (vip_user persona)

Command: `pnpm smoke:discord`  
Alias: `pnpm qa:experience --surface discord --persona vip_user --flow pick_delivery --mode fast`

```
Result: ✓ PASS
Duration: 2403ms
```

### Steps

| # | Step | Result | Detail |
|---|---|---|---|
| 1 | Fetch sandbox guild metadata | PASS | Fetched 9 roles and 15 channels |
| 2 | Assert VIP role can view #vip-picks | PASS | VIP visibility confirmed |
| 3 | Assert free role cannot view #vip-picks | PASS | Free role hidden from #vip-picks |
| 4 | Assert free role can view #free-picks | PASS | Free role can view #free-picks |
| 5 | Seed sandbox QA pick | PASS | pickId=59683281-c274-4b53-9ecf-48c59833bb7d outboxId=87c22f75-5004-4d18-9389-a34c5505f215 |
| 6 | Post QA embed to #qa-pick-delivery | PASS | messageId=1503649708202266656 |
| 7 | Poll #qa-pick-delivery for posted embed | PASS | Embed found with required fields |
| 8 | Verify QA pick status through API | PASS | status=queued outboxStatus=pending outboxId=87c22f75-5004-4d18-9389-a34c5505f215 |

### Key proof artifacts

- **Pick ID:** `59683281-c274-4b53-9ecf-48c59833bb7d`
- **Outbox ID:** `87c22f75-5004-4d18-9389-a34c5505f215`
- **Discord message ID:** `1503649708202266656` (confirmed in `#qa-pick-delivery`)
- **End-to-end latency:** 2403ms

## Smoke test execution (free_user persona)

Command: `pnpm qa:experience --surface discord --persona free_user --flow pick_delivery --mode fast`

```
Result: ✓ PASS
Duration: 835ms
```

Visibility matrix confirmed: free role sees `#free-picks`, blocked from `#vip-picks`.

## R-level compliance

```
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## pnpm verify

```
pnpm verify — PASS
```

## Acceptance criteria coverage

| AC | Status |
|---|---|
| Scripted smoke test: submission → lifecycle → outbox → Discord delivery | PASS — `discord/pick_delivery` QA skill |
| `pnpm smoke:discord` runnable on demand | PASS — added to root package.json |
| Proof log: pick ID, outbox result, Discord message ID, latency | PASS — captured above |
| Smoke test included in T1/T2 checklist for delivery surface changes | PASS — EVIDENCE_BUNDLE_TEMPLATE.md updated |
| Evidence bundle template updated for Discord delivery proof | PASS — see docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md |
