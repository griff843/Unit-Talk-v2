# PROOF: WORK-2026092708

MERGE_SHA: 826f23f5be13073f07784efb27e7bf76fa15006c

Issue: WORK-2026092708
Tier: T2
Lane type: governance
Branch: claude/work-2026092708-receipt-authority
result: pass

## ASSERTIONS:

- [x] The authority boundary reads every `distribution_receipts` row recorded in the last
      `RECEIPT_AUTHORITY_WINDOW_DAYS` (30) days with `readAllPages` (id-ordered pages), and compares
      the read against an exact `count`. A short read, a page error or an unreadable count is
      CRITICAL ("receipt read incomplete … the authority boundary was not checked"), never CLEAN.
- [x] Each receipt's logical target is `payload.target` when present, otherwise `channel`
      (`receiptLogicalTarget`). Test: "a human-capper receipt is judged by payload.target, not the
      resolved channel id".
- [x] Classification (`classifyReceiptDestination`) derives `governed` from
      `governedDeliveryTargets` in `@unit-talk/contracts`, not from a copy. Test: "every governed
      delivery target is recognised …". The canary lane is `control`, and `simulated:` receipts are
      `simulated`.
- [x] Anything else is `unrecognized`, including a bare channel id, a null channel and an
      ungoverned `payload.target` behind a governed-looking channel. Any `unrecognized` receipt in
      the window is CRITICAL and named.
- [x] The hardcoded `LIVE_TARGETS` / `LIVE_CHANNEL_IDS` lists and the `.limit(100)` sample are
      removed from `scripts/pipeline-health.ts`. The JSON report carries
      `receipt_authority_window_days`, `receipt_authority_read_complete` and
      `receipt_authority_counts`.
- [x] No database write, no delivery-path change, and no change under `apps/`. The replay
      allowlist in `apps/worker/src/replay-failed-delivery.ts` is a deliberate restriction on bulk
      re-sends, so it is untouched.

## EVIDENCE:

### 1. Live population, read-only (production `zfzdnfwdarxucxtaojxm`, 2026-09-27T18:59:10Z)

```
distribution_receipts total: 3736
old rule (channel not in canary/best-bets and matching neither channel id), over ALL rows: 2167 flagged
  -> includes both real official-picks deliveries of 2026-09-18
  -> the old code sampled 100 of these rows, unordered, so its count was arbitrary and the warning permanent
new rule, 30-day window: 2 receipts, read 2 of 2
  653db135 channel=discord:official-picks      payload.target=discord:official-picks -> governed
  71fccaa7 channel=1384052464189440120          payload.target=discord:official-picks -> governed
  governed=2 control=0 simulated=0 unrecognized=0 -> CLEAN
```

Receipt `71fccaa7` is the UTV2-1929 shape: its channel is the resolved per-capper Discord id. Only
`payload.target` shows that it is an `official-picks` delivery. A channel-only rule cannot judge it.

### 2. Mutation drills (each restored with `git checkout` of the committed file; suite then 30/30)

```
ignore payload.target (fall back to channel only)   # pass 26, fail 4
no '#' strip (discord:#canary)                       # pass 28, fail 2
hardcoded ['best-bets'] instead of the registry      # pass 26, fail 4
no simulated: branch                                 # pass 28, fail 2
```

## Verification

```
pnpm exec tsx --test scripts/ops/pipeline-health-classification.test.ts   # pass 30, fail 0
pnpm exec eslint scripts/pipeline-health.ts scripts/ops/pipeline-health-classification*.ts   # exit 0
pnpm type-check                                                     # exit 0 (lane worktree, and preflight PB1)
pnpm test                                                           # pass (preflight PB2, full suite)
pnpm verify                                                         # runs as the required `verify` CI job on this PR
pnpm exec tsx scripts/ci/r-level-check.ts --base 088423935 --head d459c6f99   # Verdict: PASS, no R-level artifacts required
```

`pnpm pipeline:health` cannot reach production from the workstation, because `local.env` carries
containment placeholders. Evidence 1 is a governed read-only SQL read of the same population.

## Merge SHA Binding

Merge SHA: `826f23f5be13073f07784efb27e7bf76fa15006c`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1674
