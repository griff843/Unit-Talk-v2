# PROOF: UTV2-1545 awaiting-approval drift — read-only classification packet

MERGE_SHA: pending merge

## Verification

Read-only classification of the `awaiting_approval` backlog against production
`zfzdnfwdarxucxtaojxm`, captured 2026-08-03T22:1x UTC. **No mutation of any kind was
performed.** Every statement below is a `SELECT`. This lane produces a dry-run packet only;
it does not approve, void, or expire anything.

## Summary

`governance.awaiting-approval-drift` has failed on every cycle (9,965 runs; latest
2026-08-03T22:00:00Z, `status=failed`, roughly one per 10 minutes). The backlog it reports is
**14,984 picks with `picks.status = 'awaiting_approval'`**.

Note the column: the drift monitor keys on `picks.status`, *not* `picks.approval_status`.
`approval_status = 'awaiting_approval'` matches **zero** rows — checking that column first
returns an empty set and reads as "no backlog". Any future query must use `status`.

## Latest successful-ingestion cutoff

| measure | value |
| -- | -- |
| `max(provider_offer_history.snapshot_at)` | **2026-06-30T12:41:02.424Z** |
| last `ingestor.cycle` start | 2026-06-30T12:55:01.190Z (`status=failed`) |
| `provider_offer_history` rows in last 30 days | **0** |

The provider cutoff (12:41:02Z) is the authoritative boundary and is used as the
pre/post-cutoff split below.

## Classification

```
bucket      window        promotion_status   rows    oldest                     newest
A_fixture   pre_cutoff    not_eligible       6616    2026-05-17 07:07:14+00     2026-06-30 10:44:42+00
A_fixture   pre_cutoff    suppressed            6    2026-05-28 23:44:44+00     2026-05-28 23:47:08+00
A_fixture   post_cutoff   not_eligible       6078    2026-06-30 14:20:06+00     2026-07-30 20:04:23+00
B_genuine   pre_cutoff    not_eligible       2146    2026-05-12 08:53:36+00     2026-06-30 12:29:32+00
B_genuine   pre_cutoff    suppressed           53    2026-05-12 08:57:34+00     2026-06-21 01:55:30+00
B_genuine   pre_cutoff    qualified             1    2026-05-17 20:13:29+00     2026-05-17 20:13:29+00
B_genuine   post_cutoff   not_eligible         84    2026-06-30 13:23:30+00     2026-07-23 01:45:25+00
```

**A — CI fixtures: 12,700 rows (84.8%).** Classified by the established marker set
([[project-ci-production-fixture-contamination]]):

```sql
metadata ? 'proof_issue'
  OR metadata->>'eventName' LIKE 'db-smoke-%'
  OR metadata->>'eventName' ~* '^utv2-'
  OR selection ~* '^UTV2-[0-9]+'
  OR source IN ('t1-proof','canary-proof','proof-harness')
```

By source: `model-driven` 4,266 · `smart-form` 3,984 · `system-pick-scanner` 2,242 ·
`alert-agent` 2,208. These four source names are *also* legitimate production source names,
which is why source alone must never be the classifier.

**B — genuine picks: 2,284 rows (15.2%).** All `source = 'system-pick-scanner'`, all real MLB
player-prop and game-total markets with real event names (`Arizona Diamondbacks vs. Colorado
Rockies`, `player_batting_walks_ou`, …). `selection` is literally `over`/`under`, so a
per-day `count(DISTINCT selection)` of 1–2 is an artifact of that column's shape and **must
not** be read as duplicate/synthetic rows — market plus event carries the identity.

## Stale pre-recovery vs. legitimate post-recovery

**There are zero legitimate post-recovery rows, because no recovery has occurred.** Ingestion
stopped 2026-06-30T12:41:02Z and has not resumed; the ingestor is currently parked
(`autorun: false`) — see UTV2-1477. Therefore every one of the 14,984 rows predates any
recovery.

Two findings inside bucket B deserve separate handling:

1. **84 genuine rows were created *after* the ingestion cutoff** (2026-06-30T13:23:30Z →
   2026-07-23T01:45:25Z), i.e. `system-pick-scanner` kept producing picks for ~23 days on
   provider data that had already gone stale. That is the blind-producer signature tracked by
   UTV2-1610, observed here independently. They are stale by construction — the offers they
   were derived from were already frozen — and are not "post-recovery legitimate".
2. **Exactly one row is `promotion_status = 'qualified'`** — the only row in the entire
   backlog in a deliverable promotion class. Created 2026-05-17T20:13:29Z; its MLB game
   settled roughly two and a half months ago. Every other row is `not_eligible` (14,924) or
   `suppressed` (59).

## Dry-run void/expire packet (idempotent, NOT executed)

Each statement is guarded on `status = 'awaiting_approval'` so a re-run after partial
application is a no-op, and each is scoped by immutable classification predicates rather than
by a row-ID list that could go stale between generation and application.

```sql
-- ============ DRY RUN ONLY — do not execute without explicit authorization ============
BEGIN;

-- Group A — CI fixtures (expected: 12700)
SELECT count(*) AS a_fixtures_to_expire
FROM picks
WHERE status = 'awaiting_approval'
  AND ( metadata ? 'proof_issue'
     OR metadata->>'eventName' LIKE 'db-smoke-%'
     OR metadata->>'eventName' ~* '^utv2-'
     OR selection ~* '^UTV2-[0-9]+'
     OR source IN ('t1-proof','canary-proof','proof-harness') );

-- Group B1 — genuine, pre-cutoff, non-qualified (expected: 2199)
SELECT count(*) AS b1_stale_to_expire
FROM picks
WHERE status = 'awaiting_approval'
  AND NOT ( metadata ? 'proof_issue'
         OR metadata->>'eventName' LIKE 'db-smoke-%'
         OR metadata->>'eventName' ~* '^utv2-'
         OR selection ~* '^UTV2-[0-9]+'
         OR source IN ('t1-proof','canary-proof','proof-harness') )
  AND created_at < '2026-06-30T12:41:02.424Z'
  AND promotion_status <> 'qualified';

-- Group B2 — genuine, post-cutoff blind-produced (expected: 84)
SELECT count(*) AS b2_blind_to_expire
FROM picks
WHERE status = 'awaiting_approval'
  AND NOT ( metadata ? 'proof_issue'
         OR metadata->>'eventName' LIKE 'db-smoke-%'
         OR metadata->>'eventName' ~* '^utv2-'
         OR selection ~* '^UTV2-[0-9]+'
         OR source IN ('t1-proof','canary-proof','proof-harness') )
  AND created_at >= '2026-06-30T12:41:02.424Z';

-- Group B3 — the single qualified row, HELD OUT for individual owner review (expected: 1)
SELECT id, created_at, market, selection, promotion_status, metadata->>'eventName' AS event
FROM picks
WHERE status = 'awaiting_approval' AND promotion_status = 'qualified';

ROLLBACK;
-- ======================================================================================
```

Applying the packet would replace each `SELECT count(*)` with the corresponding
`UPDATE picks SET status = 'expired', updated_at = now() WHERE <same predicate>`, executed in
one transaction with a post-update assertion that `count(*) FILTER (status='awaiting_approval')`
equals 1 (the held-out qualified row). **That UPDATE form is deliberately not written out
here** so this file cannot be copy-pasted into a mutation.

## ASSERTIONS:

- [x] Every statement executed for this packet was a read-only `SELECT`; no `UPDATE`, `DELETE`, `INSERT`, or DDL touched production.
- [x] The backlog is keyed on `picks.status`, not `picks.approval_status`; the latter matches zero rows.
- [x] The ingestion cutoff is `max(provider_offer_history.snapshot_at) = 2026-06-30T12:41:02.424Z`, with zero provider rows in the last 30 days.
- [x] 12,700 of 14,984 rows carry a CI-fixture marker; 2,284 are genuine `system-pick-scanner` MLB picks.
- [x] Zero legitimate post-recovery rows exist, because ingestion has not resumed.
- [x] Exactly one row is `promotion_status = 'qualified'`; it is held out of every bulk group for individual review.
- [x] 84 genuine rows were produced after the ingestion cutoff, independently corroborating the UTV2-1610 blind-producer finding.
- [x] No bulk approval, void, or expiration was performed.

## EVIDENCE:

Backlog total and column disambiguation:

```
SELECT count(*) FROM picks WHERE approval_status = 'awaiting_approval';  -- 0 rows
SELECT count(*) FROM picks WHERE status          = 'awaiting_approval';  -- 14984
```

Ingestion cutoff:

```
provider_cutoff
2026-06-30 12:41:02.424+00

latest_snapshot | age  | rows_last_30d
null            | null | 0
```

Drift monitor failing every cycle:

```
run_type                            total  last_started                  last_status
governance.awaiting-approval-drift  9965   2026-08-03 22:00:00.163931+00 failed
```
