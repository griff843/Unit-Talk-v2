# UTV2-107 — Worker Runtime Activation and Outbox Drain Proof

**Status:** PASS  
**Verified:** 2026-03-28  
**Branch:** `codex/UTV2-107-worker-runtime-activation`

---

## Runtime Configuration

Proof command:

```powershell
pnpm --filter @unit-talk/worker proof:outbox-drain
```

Observed runtime:

- `persistenceMode = database`
- `workerId = worker-canary`
- `distributionTargets = [discord:canary, discord:best-bets, discord:trader-insights]`
- `adapterKind = discord`
- `dryRun = false`
- `maxCycles = 1`
- `pollIntervalMs = 5000`
- `autorun = true`

---

## Before Snapshot

At `2026-03-28T02:39:18.530Z`, recent target-scoped outbox counts were:

- `pending = 5`
- `sent = 14`

Pending rows at proof start:

- `7bccf080` → pick `d77a35b3` → `discord:trader-insights`
- `757a94aa` → pick `306deff8` → `discord:best-bets`
- `29d46a09` → pick `4701f767` → `discord:trader-insights`
- `bc822cd0` → pick `3ec17a5e` → `discord:best-bets`
- `94fa2867` → pick `3b5d9e84` → `discord:best-bets`

---

## Cycle Result

Single bounded cycle result:

- `discord:canary` → `idle`
- `discord:best-bets` → `sent`
- `discord:trader-insights` → `sent`

Rows drained in this proof run:

- Outbox `94fa2867` for pick `3b5d9e84` moved `pending → sent`
  - Claimed by `worker-canary` at `2026-03-28T02:39:16.561+00:00`
  - Receipt `a4b0ca68`
  - Discord message id `1487279894458142740`
  - Recorded at `2026-03-28T02:39:19.512938+00:00`

- Outbox `29d46a09` for pick `4701f767` moved `pending → sent`
  - Claimed by `worker-canary` at `2026-03-28T02:39:17.498+00:00`
  - Receipt `4ca46d05`
  - Discord message id `1487279898698715168`
  - Recorded at `2026-03-28T02:39:20.566124+00:00`

New worker runs created by this proof:

- `d56496e9` — `distribution.process` — `succeeded`
- `c51f246b` — `distribution.process` — `succeeded`

---

## After Snapshot

After the bounded drain cycle, target-scoped outbox counts were:

- `pending = 3`
- `sent = 16`

Delta confirmed by the proof script:

- `94fa2867` changed from `pending` to `sent`
- `29d46a09` changed from `pending` to `sent`

Remaining pending rows after this run:

- `7bccf080` → pick `d77a35b3` → `discord:trader-insights`
- `757a94aa` → pick `306deff8` → `discord:best-bets`
- `bc822cd0` → pick `3ec17a5e` → `discord:best-bets`

---

## Acceptance Criteria

- AC-1: PASS — current-stage worker runtime was exercised through the DB-backed worker path
- AC-2: PASS — pending outbox rows progressed and drained under the current worker model
- AC-3: PASS — proof captured concrete outbox ids, receipt ids, run ids, timestamps, and outcomes
- AC-4: PASS — worker package tests/type-check/build passed on this branch
- AC-5: PASS — runtime truth now captured as a durable repo proof artifact

---

## Notes

- The proof command initially returned `NOT_PROVEN` in this worktree because `local.env` is ignored here.
- Re-running with the active workspace env available proved the runtime successfully.
