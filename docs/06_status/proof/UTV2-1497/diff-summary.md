# UTV2-1497 Diff Summary

## Change

Adds a standalone T1 live-DB proof test confirming `DatabaseOutboxRepository.claimNextAtomic` — the atomic `SELECT ... FOR UPDATE SKIP LOCKED` outbox claim used by `apps/worker`'s drain cycle — is race-safe under real concurrent load against real Postgres. No production code is changed.

- `apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts` (new) — creates 8 real `picks` + `distribution_outbox` rows for one synthetic target, then races 12 concurrent `claimNextAtomic` calls (distinct worker ids) against them via `Promise.all`. Asserts the claimed-row set is disjoint, covers every enqueued row exactly once, and that the 4 excess callers correctly receive `null` rather than a duplicate claim.
- `package.json` — wires the new test into `test:t1-proof:live` so it runs as part of `pnpm verify` going forward (authorized via `scope-override/v1` PR comment; outside the lane's original `file_scope_lock`).
- `docs/06_status/proof/UTV2-1497/verification.md`, `evidence.json` — proof bundle.

## Result

Zero races surfaced. The existing `claim_next_outbox` Postgres RPC (backing `claimNextAtomic`) already correctly serializes concurrent claimants via row-level locking — confirmed against real Postgres, not InMemory. Per the issue's own plan-gate spec, this means no production code change was in scope for this lane.

## Merge order

Standalone. No dependency on any other open lane.

---

Generated at: 2026-07-15T01:56:38.242Z
Issue: UTV2-1497
Tier: T1
Lane type: runtime
Branch: claude/utv2-1497-atomic-outbox-claim
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1221
Head SHA: fd7794cce7cc741d2474eec7542af1ead3af5ed9
Merge SHA: fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7
Diff base: fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7^1
Diff target: fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7

## Git Diff Stat
```
.ops/sync/UTV2-1497.yml                            |  10 ++
 ...proof-utv2-1497-outbox-concurrent-claim.test.ts | 157 +++++++++++++++++++++
 docs/06_status/lanes/UTV2-1497.json                |  36 +++++
 docs/06_status/proof/UTV2-1497/diff-summary.md     |  20 +++
 docs/06_status/proof/UTV2-1497/evidence.json       |  64 +++++++++
 docs/06_status/proof/UTV2-1497/verification.md     | 108 ++++++++++++++
 package.json                                       |   2 +-
 7 files changed, 396 insertions(+), 1 deletion(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1497.yml
A	apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts
A	docs/06_status/lanes/UTV2-1497.json
A	docs/06_status/proof/UTV2-1497/diff-summary.md
A	docs/06_status/proof/UTV2-1497/evidence.json
A	docs/06_status/proof/UTV2-1497/verification.md
M	package.json
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: fd7794cce7cc741d2474eec7542af1ead3af5ed9
Merge SHA: fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7
