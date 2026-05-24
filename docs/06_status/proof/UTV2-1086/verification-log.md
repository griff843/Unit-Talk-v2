# Verification Log — UTV2-1086
# INIT-1.1.3 — Snapshot Cutover and Point-in-Time Reconstruction

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1086 |
| Tier | T1 |
| Phase / Gate | WS-1.1 — Immutable Market Truth |
| Owner | claude/utv2-1086-dispatch |
| Date | 2026-05-24 |
| Verifier Identity | claude/utv2-1086-dispatch |
| Commit SHA(s) | aecc3b81 (bind to merge SHA at closeout) |
| Related PRs | #842 |

## Scope

**Claims:**
- `OddsSnapshotRepository` now exposes `queryAtTimestamp(timestamp, providerKey, league)` for point-in-time reconstruction
- `provider_offer_current` is labeled as a derived projection at the DB layer via `COMMENT ON TABLE`
- 50-timestamp reconstruction proven against live Supabase project `zfzdnfwdarxucxtaojxm`
- Adversarial validation: a snapshot inserted after the query timestamp is not returned

**Does NOT claim:**
- Full cutover of all operational pipeline reads away from `provider_offer_current` (those remain for performance; the projection is labeled, not removed)
- Any change to `pnpm test:db` (database-smoke.test.ts) — existing tests unchanged

## Assertions

| # | Assertion | Status |
|---|---|---|
| 1 | `queryAtTimestamp` added to `OddsSnapshotRepository` interface | PASS |
| 2 | `InMemoryOddsSnapshotRepository.queryAtTimestamp` correctly filters by timestamp | PASS |
| 3 | `DatabaseOddsSnapshotRepository.queryAtTimestamp` queries `odds_snapshots` with `lte(snapshot_at, timestamp)` | PASS |
| 4 | 50 snapshots inserted + reconstructed correctly via `queryAtTimestamp` against live Supabase | PASS |
| 5 | `queryAtTimestamp` returns null for timestamp before any data | PASS |
| 6 | Adversarial: later snapshot not visible at earlier query timestamp | PASS |
| 7 | Migration `20260524001_utv2_1086_snapshot_cutover.sql` applied — COMMENT on `provider_offer_current` confirmed live | PASS |
| 8 | `pnpm verify` green — 113/113 tests pass, type-check clean, lint clean | PASS |
| 9 | R-level check PASS — no artifacts required | PASS |

## Evidence Blocks

```text
=== T1 Proof Test Run ===
UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1086-snapshot-cutover.test.ts

TAP version 13
ok 1 - queryAtTimestamp: 50-timestamp point-in-time reconstruction
  duration_ms: 12712.894723
ok 2 - queryAtTimestamp: returns null before earliest snapshot
  duration_ms: 113.726873
ok 3 - queryAtTimestamp: adversarial — later snapshot not visible at earlier timestamp
  duration_ms: 412.313995
1..3
# tests 3 / pass 3 / fail 0 / skipped 0

=== pnpm verify ===
# tests 113 / pass 113 / fail 0 / skipped 0

=== R-level check ===
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff

=== Migration Verification (live Supabase zfzdnfwdarxucxtaojxm) ===
SELECT obj_description('public.provider_offer_current'::regclass, 'pg_class') AS table_comment;
→ "DERIVED PROJECTION — not truth. Materialized hot-current view of provider odds,
   maintained for pick-pipeline operational reads.
   Canonical truth for point-in-time reconstruction is odds_snapshots (UTV2-1085).
   Do not treat this table as authoritative for historical market state.
   Demoted per INIT-1.1.3 / UTV2-1086."
```

## Acceptance Criteria Mapping

| AC | Criterion | Evidence |
|---|---|---|
| 1 | Point-in-time query interface over OddsSnapshot | `queryAtTimestamp` added to interface + both implementations |
| 2 | No downstream layer treats projection as canonical truth | DB COMMENT labels projection; interface routes truth reads to snapshot store |
| 3 | projection is read-only-labeled; truth reads route to snapshot store | COMMENT ON TABLE applied live; `queryAtTimestamp` routes to `odds_snapshots` |
| 4 | Point-in-time reconstruction for any historical timestamp | 50-timestamp proof PASS against live DB |
| 5 | 50-timestamp reconstruction proven | T1 proof test ok 1 — 12.7s, 50 inserts + queries |
| 6 | Adversarial: reconstruct market state and verify exact snapshot match | T1 proof test ok 3 — adversarial PASS |

## Stop Conditions Encountered

None.

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — 113/113 tests, type-check clean, lint clean |
| T1 live-DB proof | PASS — 3/3 tests against live Supabase zfzdnfwdarxucxtaojxm |
| Migration applied | PASS — COMMENT ON TABLE confirmed live |
| R-level | PASS — no artifacts required |
| Adversarial | PASS — later snapshot not visible at earlier query timestamp |

## Sign-off

| Field | Value |
|---|---|
| Verifier | claude/utv2-1086-dispatch |
| Verified at | 2026-05-24T16:30:00Z |
| Outcome | PASS — ready for PR open and PM t1-approved label |
