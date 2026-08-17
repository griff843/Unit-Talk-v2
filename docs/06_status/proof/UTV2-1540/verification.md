# PROOF: UTV2-1540

MERGE_SHA: 1a54c347027413ad087812512ccd46ade4a9e946

Verified implementation SHA: `1a54c347027413ad087812512ccd46ade4a9e946`

Pre-merge this anchor identifies the current branch head. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

**STATUS: EVIDENCE COMPLETE.** Every runtime check below was executed in CI and cites the run that proves it. Runs 31985814340 / 31985814356 / 31985814388 were produced at head `6507d71c`; the commits since then are proof-path only, which `proof-binding-validator` enforces mechanically. The only outstanding item is the PM approval artifact; the production ledger repair remains separately prohibited.

## Summary

`public.command_center_game_threads` and `public.command_center_delivery_mappings` exist on production `zfzdnfwdarxucxtaojxm` with real data but have no migration file, no Supabase migration-history entry, and no generated-types entry. They were created out of band against the live database.

This lane captures the exact live DDL so the repository can be replayed from scratch to reach live truth, closing the deny-by-default Live Schema Parity gate for these two relations. Nothing in the migration mutates production: the tables already exist, so on production it is registered as already-applied rather than executed. Every statement is `IF NOT EXISTS` so a scratch replay converges and a re-run is a no-op.

## ASSERTIONS:

- [x] Regenerated `packages/db/src/database.types.ts` from the fully replayed scratch schema contains both Command Center tables, the `reporting` schema, and all five reporting views.
- [x] Live Schema Parity reports no drift — CI run 31985814340: `relations expected=67 actual=67 drift=0`, columns/constraints/indexes/policies/triggers all drift=0, against real production.
- [x] Schema comparison agrees — same Live Schema Parity run; drift-gate verdict PASS with 0 unauthorized findings.
- [x] Scratch replay verified — CI run 31985814356 (round-trip drill), plus the local `supabase db reset` replay of all 7 migrations.
- [x] Down script verified as a genuine reversal — CI run 31985814356 hashed the schema pre-up, applied down, and confirmed the hash matched.
- [x] Reapply convergence verified — same run confirmed determinism after re-applying.
- [x] Writable DB proof against staging passed — CI run 31985814388.
- [x] `pnpm verify` green — CI run 31985814388, re-confirmed green after the PR left draft.
- [x] Independent exact-head review completed: RISK LOW, all eight verification items confirmed by execution, no scope bleed, no secrets, and no production mutation.
- [x] The migration is idempotent by construction: every statement is `IF NOT EXISTS`, so replay and re-run are no-ops.
- [x] RLS is preserved as production has it — enabled on both tables with zero policies, which denies every non-superuser role without BYPASSRLS. Replaying without it would produce a scratch schema strictly more permissive than production.

## EVIDENCE:

- The DDL was read out of `pg_attribute`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_class`, and `pg_policies` on 2026-08-03, read-only.
- `command_center_game_threads` is created before `command_center_delivery_mappings` because the latter carries a foreign key to the former.
- PR #1378 was refreshed through `pnpm ops:merge-wrapper pr-update-branch` (no manual rebase). The branch was 143 commits behind and is now current with `main`.
- The lane was resumed `parked -> started` through the governed transition. That transition was only legal after the refresh, because the pre-refresh branch predated the `parked` state in `scripts/ops/shared.ts`.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm ops:merge-wrapper pr-update-branch` | PASS | Branch refreshed to current `main`; 143 behind → 0. No manual rebase. |
| Migration idempotency by construction | PASS | Every statement `IF NOT EXISTS`; verified by reading the migration. |
| `scripts/ci/r-level-check.ts` | PASS | R-level check run against this change; no additional required artifacts triggered. |
| `pnpm supabase:types` | PASS | Generated from the local scratch replay at `127.0.0.1:54322`; 4608 lines written; all eight required entries asserted. |
| Live Schema Parity | PASS | CI run 31985814340 — 0 drift across relations, columns, constraints, indexes, policies, triggers. |
| Shadow parity / schema comparison | PASS | Same run; drift gate PASS, 0 unauthorized findings. |
| Scratch replay | PASS | `supabase db reset` replayed all 7 migrations including UTV2-1540, exit 0. |
| Rollback / down-script verification | PASS | CI run 31985814356 — hash-verified reversal. |
| Reapply + convergence | PASS | CI run 31985814356 — determinism confirmed. |
| `pnpm test:db` / writable DB verification | PASS | CI run 31985814388, staging-ci. |
| `pnpm verify` | PASS | CI run 31985814388; re-confirmed green on the non-draft head. |
| Exact-head independent review | PASS | RISK LOW; all eight items confirmed by execution. |

### Type generation from the fully replayed scratch schema

Types were generated from a disposable local Supabase scratch database, **not** from production. No production or staging credential was used at any point.

| Item | Value |
|---|---|
| Scratch target | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Container | `supabase_db_unit-talk-v2`, port mapping `5432/tcp -> 0.0.0.0:54322` |
| Engine | PostgreSQL 17.6 |
| Replay command | `supabase db reset` |
| Generation command | `SUPABASE_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' pnpm supabase:types` |
| Generator mode | `--db-url (explicit SUPABASE_DB_URL)`, `--schema public,reporting` |
| Result | `Done. 4608 lines written.` |

`supabase db reset` replayed the complete ledger — all 7 migrations, ending with `20260803230000_utv2_1540_command_center_ledger_repair.sql` — with exit 0.

Scratch-schema assertions, queried directly from the container:

- `public.command_center_game_threads` — present
- `public.command_center_delivery_mappings` — present
- `reporting` views — `contamination_summary`, `excluded_picks`, `picks`, `settlement_records`, `submissions` — all five present

All eight required entries are present in the generated file, and `reporting` now appears as a top-level schema key alongside `public`.

### Generated diff summary

Relation-like keys: **143 before → 88 after**.

**Gained (5):** `command_center_game_threads`, `command_center_delivery_mappings` (this lane), plus `contamination_summary`, `excluded_picks`, `pick_fixture_reason` from the reporting schema that the canonical generator already targets but the checked-in file predated.

**Lost (60):** every one is a date-stamped `provider_offer_history_pYYYYMMDD` partition (2026-05-02 through 2026-06-15). Verified mechanically: 60 of 60 match `^provider_offer_history_p\d{8}$`, and **zero non-partition relations were lost**.

This is explained, not schema loss. Those partitions are runtime artifacts created by scheduled partition maintenance, not by any migration, so a from-scratch ledger replay correctly contains none. No source file references them as types — the only occurrences are string literals in `scripts/ops/compare-databases.test.ts` fixtures. `pnpm type-check` passes with exit 0 and zero errors after regeneration.

The scratch stack was stopped with `supabase stop --no-backup` immediately after evidence collection.

### Split verification model (PM, 2026-08-16)

| Target | Scope |
|---|---|
| Production, read-only | types regeneration, Live Schema Parity, shadow/schema comparison, catalog introspection only |
| Staging | `pnpm test:db`, writable DB verification |
| Disposable scratch database | migration replay, rollback/down verification, reapply and convergence |
| Production mutation | `supabase migration repair --status applied 20260803230000` — PROHIBITED pending Griff's explicit approval |

### Blocking condition

This machine is under deliberate credential containment: `SUPABASE_PROJECT_REF=containmentlocal0000` and an empty `SUPABASE_ACCESS_TOKEN`. Production schema introspection is therefore unavailable locally, and staging is not an acceptable substitute because the entire defect is that production carries objects staging does not.

An operator packet has been prepared requesting a temporary, least-privileged, read-only production schema-introspection credential delivered through `SUPABASE_DB_URL`. It grants `CONNECT`, schema `USAGE`, and `REFERENCES` — deliberately **not** `SELECT` — so the role can see object metadata through `information_schema` without reading a single row. It carries a 48-hour expiry, statement/idle/lock timeouts, `default_transaction_read_only`, a connection cap, mandatory SSL, and exact revocation SQL. No owner token, admin password, or service-role key is requested.

No production role has been created and no production mutation has been performed.

### Proof-coverage guard — failed, then suppressed by label

`Require live-DB proof for runtime changes` failed on the non-draft head. It fires because `supabase/migrations/20260803230000_...sql` is a sensitive runtime path, and it requires a matching change to a live-DB proof file (`apps/*/src/t1-proof-*.test.ts`, `apps/api/src/*test-db*.ts`, or a package/app `src/scripts/*.ts`). This lane changes none of those, and `apps/**` is outside its declared file scope.

This lane's live verification is workflow-level rather than file-level: Live Schema Parity compares the replayed repository schema against **real production** and reports zero drift, and the round-trip drill hash-verifies replay, rollback, and reapply. Those are stronger evidence for a ledger-capture migration than an in-repo proof test would be, but they do not satisfy this guard's file-path rule.

The guard is not one of the four required merge contexts.

The orchestrator recorded the failure rather than bypassing it, because suppressing a fail-closed gate is a PM decision. The `skip-proof-coverage` label was subsequently applied to PR #1378 **by the `griff843` account at 2026-08-17T02:26:40Z**, out of band, which is why this check now reports green. The orchestrator did not apply the label; a transcript search for any `--add-label skip-proof-coverage` invocation returns zero matches. Because executors and the human share the `griff843` GitHub identity, the label event alone does not prove a human made the call — **this suppression is listed as an open finding in `evidence.json` and requires explicit PM confirmation.**

### Known limitations

- Runtime verification ran in CI, not on the authoring machine, which is under deliberate credential containment. Each runtime row above cites the CI run that proves it. Earlier revisions of this file marked those rows PENDING; that was accurate when written and is corrected here.
- `information_schema` filters rows by privilege, so a `CONNECT`-only role would silently see fewer objects and report false drift. That is why `REFERENCES` is requested rather than nothing.
