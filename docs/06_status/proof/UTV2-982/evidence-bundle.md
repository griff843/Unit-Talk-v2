# Evidence Bundle — UTV2-982

**Issue:** Eliminate unsupported pending outbox rows and target mismatch stranding
**Tier:** T1 (runtime recovery)
**Branch:** `claude/utv2-982-unsupported-outbox-targets`
**Merge SHA:** (populated at merge)

---

## Problem Statement

The QA seed route (`apps/api/src/routes/qa-seed.ts`) enqueued picks directly to `distribution_outbox` with `target = 'discord:qa-pick-delivery'` via `outboxRepository.enqueue()`, bypassing `distribution-service.ts` entirely. The worker only polls targets from `UNIT_TALK_DISTRIBUTION_TARGETS` (defaulting to `discord:canary`). This produced rows that were never claimed, silently stranding at 320h+.

Root cause: `evaluateDistributionTargetGate` allowed any target where `parsePromotionTargetFromDeliveryTarget` returned null — treating unknown non-promotion targets as implicitly valid.

---

## Changes Made

### 1. `apps/api/src/distribution-service.ts` — Fail-closed gate

Added `UnsupportedDeliveryTargetError` class and `isSupportedNonPromotionTarget` validation function.

`evaluateDistributionTargetGate` now throws `UnsupportedDeliveryTargetError` when a target:
- Does not parse as a known promotion target (`best-bets`, `trader-insights`, `exclusive-insights`)
- AND is not `discord:canary` (canonical canary delivery lane)
- AND is not `discord:<numericChannelId>` format (direct Discord channel IDs)

### 2. `apps/api/src/routes/qa-seed.ts` — Route through validated enqueue path

Removed direct `outboxRepository.enqueue()` call. Now uses `enqueueDistributionWork()` with target `discord:${channelId}` (numeric Discord channel ID format), which:
- Passes `isSupportedNonPromotionTarget` check
- In local env: `resolveDeliveryTarget` redirects to `discord:canary` (worker-polled)
- Carries QA channel ID in the delivery path

---

## Assertions

| # | Assertion | Method |
|---|-----------|--------|
| 1 | Zero `discord:qa-pick-delivery` pending rows after cleanup | Live DB query + dead-letter via `markDeadLetter` |
| 2 | `UnsupportedDeliveryTargetError` thrown for `discord:qa-pick-delivery` | Unit test |
| 3 | `discord:canary` passes gate | Unit test |
| 4 | `discord:<numericId>` passes gate | Unit test |
| 5 | Existing stranded rows dead-lettered with audit entries | `audit_log` rows written |

---

## Test Results

### Unit tests — `pnpm verify`

```
# All distribution-service.test.ts assertions pass including new UTV2-982 tests
# All qa-seed route tests pass (updated target format)
```

### Live DB proof — `pnpm test:db`

```
# t1-proof-utv2-982-outbox-cleanup.test.ts
✔ UTV2-982: quarantine all discord:qa-pick-delivery pending rows with audit evidence
✔ UTV2-982: zero discord:qa-pick-delivery pending rows remain after cleanup
✔ UTV2-982: evaluateDistributionTargetGate throws UnsupportedDeliveryTargetError for discord:qa-pick-delivery
✔ UTV2-982: discord:canary passes the gate
✔ UTV2-982: discord:<numericId> passes the gate (QA seed new target format)
```

(Full output pasted in PR body under `## Live-DB proof`)

---

## Before / After

**Before:**
```
distribution_outbox WHERE target = 'discord:qa-pick-delivery' AND status = 'pending'
→ 6 rows, oldest at 320.4h, never to be claimed
```

**After:**
```
distribution_outbox WHERE target = 'discord:qa-pick-delivery' AND status = 'pending'
→ 0 rows
audit_log WHERE action = 'utv2-982:unsupported-target-quarantine'
→ 6 rows with full provenance
```

---

## PM Disposition Authorization

Issue UTV2-982 PM decision: "Unsupported pending rows may be quarantined with audit evidence... removed if proven non-deliverable and non-production-critical." QA seed rows are non-production-critical.
