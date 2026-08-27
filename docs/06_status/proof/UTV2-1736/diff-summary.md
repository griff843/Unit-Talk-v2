# UTV2-1736 — diff summary

MERGE_SHA: 58755c370d7766604b8612778b5afc17fb8d5ffe

## Files changed

| File | Lines | Purpose |
|---|---|---|
| `supabase/migrations/20260824000000_utv2_1736_offer_history_forward_partitions.sql` | +201 | Provisions every daily partition from 2026-07-01 through 2026-11-24 (147) on `provider_offer_history`, using the lean three-index shape matching current production. Asserts complete coverage and asserts no DEFAULT partition exists. Ships a commented, manual rollback that drops only the partitions it provisions and only while empty. Adds `list_provider_offer_history_partition_days()` for the monitor. |
| `scripts/ops/partition-provisioner.ts` | +338 | Read-only forward-coverage monitor. Never issues DDL. Computes the unbroken forward coverage run from today, evaluates it against warn/critical day thresholds, and writes the verdict to the real operations sinks (`system_runs` via startRun/completeRun, and `audit_log.record`). |
| `scripts/ops/partition-provisioner.test.ts` | +204 | 10 tests covering naming round-trip, unbroken-run coverage semantics, threshold boundaries, inverted-threshold rejection, real-sink write on an induced CRITICAL, audit-sink failure propagation, and the absence of DEFAULT/DROP in the emitted SQL. |
| `docs/06_status/proof/UTV2-1736/verification.md` | rewritten | Proof bundle: production truth, seven executed scenarios, known gaps. |
| `docs/06_status/proof/UTV2-1736/diff-summary.md` | rewritten | This file. |
| `docs/06_status/proof/UTV2-1736/evidence.json` | rewritten | Schema v2 evidence with SHA binding, row counts, scenarios, and known gaps. |
| `docs/06_status/proof/UTV2-1736/model-routing.json` | rewritten | Model routing record. |
| `package.json` | +1 | Wires `scripts/ops/partition-provisioner.test.ts` into `test:ops` so this lane's 10 tests execute under required `verify`. `test:ops` is a hardcoded file list, not a glob. PM-authorized scope extension. |
| `docs/06_status/lanes/UTV2-1736.json` | modified | Adds `package.json` and the manifest's own path to `file_scope_lock`, plus a `scope_override` block recording the PM authorization. |

## Design decisions, and what was deliberately not done

- **Lean three-index shape**, matching current production. The six additional
  legacy indexes are **not** restored in this lane — that is a separate decision
  with its own write-amplification cost.
- **No DEFAULT partition.** An out-of-range insert must keep failing closed. A
  catch-all would convert a loud, correct error into silent misfiling, and the
  migration asserts no DEFAULT exists rather than merely omitting one.
- **Rollback refuses rather than destroys.** A non-empty partition is data. The
  rollback prints `REFUSED: % holds % row(s); leaving attached` and continues.
- **Rollback is commented, not auto-applied.** Nothing in this migration can
  drop a partition as a side effect of running it.
- **The monitor issues no DDL.** It reports and alerts; provisioning stays an
  explicit, reviewed migration.
- **`pg_cron` job 5 is untouched.** It has failed 109/109 times since
  2026-05-10, so retention has never run. Containing and redesigning it is
  Successor A and needs its own production decision. This lane neither removes
  its illegal `audit_log` mutation nor lets the remaining transaction run.

## Filename note

The migration is named `20260824000000_...`, which is what this lane's immutable
`file_scope_lock` declares. An earlier preservation branch used
`20260822000000_...`; that name is not the lane's declared scope and is not used
here.

## Blast radius

No production DDL is applied by merging this PR. The migration must still be
applied deliberately, and applying it is a separate production decision that
should not precede a decision on `pg_cron` job 5 — provisioning forward without
containing job 5 converts a fail-closed error into unbounded growth.
