# UTV2-1383 — diff summary

MERGE_SHA: 825259a0b5279ab9c35508582ac1eedb5aa7398f

Audit phase only. **No production mutation** — every database statement executed was a SELECT. No backfill, no deletion, no quarantine, no constraint validation, no migration, no schema change, no runtime or dependency change.

## Files

Only this lane's own proof bundle, sync file, and manifest. No `apps/`, no `packages/`, no `supabase/migrations/`, no `.github/workflows/`.

## What the audit changes

Nothing in the product. It changes what is *known*:

1. **The population is closed and re-measured.** 2,902 of 107,858 picks, re-derived rather than taken from the issue title, with no NULL rows created since 2026-05-08.

2. **The repair premise is inverted.** The issue withheld authorization for a blanket `= 1` because it could corrupt varied stake history. There is no varied history — 99.99% of staked rows are exactly `1.00` and five distinct values exist table-wide. The real hazard is **provenance**: writing `1` without a marker yields a row indistinguishable from an observed stake. The proposed design therefore makes a provenance stamp mandatory.

3. **Nothing is derivable.** No `stakeUnitsSource`, no stake key in any submission payload examined, `kellySizing` JSON-null on 2,891, settlement stake NULL on all 11 with records. No segment can be repaired from surviving evidence.

4. **The constraint is live-blocking, not merely untidy.** `picks_stake_units_canonical_check` is `NOT VALID`, and because an UPDATE re-evaluates the CHECK against the full row and rolls back, it already forces a runtime skip path in the candidate scanner.

## What this PR does not do

No disposition is executed. Each proposed disposition — reconstruct-writer-default, delete-as-fixture, quarantine — names the PM authorization it requires and awaits it.

A member-visible live-path defect found during the audit is filed as separate bounded work rather than fixed here, because this lane is authorized read-only.
