# UTV2-1393 Verification

## Summary

Auto-reap orphaned merge-lock entries whose owner PID is confirmed dead. `scripts/ops/merge-mutex.ts` now records the owner PID and hostname in the lock file, checks PID liveness (`isProcessAlive`) for same-host locks, and treats a held lock with a confirmed-dead owner PID as orphaned: acquisition auto-reaps it instead of silently blocking until TTL expiry, and the guard surfaces `stale_reclaim_required` without a manual `ps` check. Cross-host locks are never treated as orphaned, and genuinely expired locks keep the existing explicit-reclaim behavior (no regression).

Branch: `claude/utv2-1393-auto-reap-orphaned-merge-lock`
Verified source SHA: 980793b35a52b01e5c45142efcba71bdf9c49bf5

## Evidence

- `scripts/ops/merge-mutex.ts` — owner PID/host capture, `isProcessAlive`, orphan detection, auto-reap on acquire, guard surfacing.
- `scripts/ops/merge-mutex.test.ts` — 18 tests covering orphan auto-reap, live-PID blocking, cross-host safety, direct reclaim of unexpired-orphaned locks, guard surfacing, TTL-expiry regression, and a real exited-process end-to-end case.

## Verification

Executed on branch at 980793b35a52b01e5c45142efcba71bdf9c49bf5.

Command: `tsx --test scripts/ops/merge-mutex.test.ts`

```
ok 1 - acquire writes a held merge lock
ok 2 - acquire fails closed when another unexpired lock exists
ok 3 - acquire fails closed when required fields are missing
ok 4 - expired lock becomes stale and requires explicit reclaim
ok 5 - reclaim overwrites only an explicitly stale lock
ok 6 - release fails when the holder does not match
ok 7 - release marks the lock released for the owning issue and branch
ok 8 - acquire can reuse a released lock file without manual deletion
ok 9 - guard fails closed without a held matching lock
ok 10 - guard passes for the held lock owner
ok 11 - a held lock with a confirmed-dead PID on the same host is auto-reaped instead of silently blocking
ok 12 - a held lock with a live PID on the same host still blocks acquisition
ok 13 - a cross-host lock is never treated as orphaned, even if its PID would report dead locally
ok 14 - an unexpired-but-orphaned lock can be reclaimed directly, without waiting for TTL expiry
ok 15 - the guard surfaces stale_reclaim_required for an orphaned lock without requiring a manual ps check
ok 16 - a genuinely expired lock is still reclaim_required regardless of PID liveness (no regression)
ok 17 - isProcessAlive reflects real OS process state: true for self, false for an exited child PID
ok 18 - end-to-end: a lock owned by a real exited process on this host is detected as orphaned without any override
# tests 18
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `pnpm test:db` (live Supabase)

```
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 16514.839652
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 18284.346211
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 102167.34774
```
