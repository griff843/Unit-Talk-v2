# PROOF: UTV2-1540

MERGE_SHA: 709d1c9c037a56ec681801461c7493790887c3e5

Verified implementation SHA: `709d1c9c037a56ec681801461c7493790887c3e5`

Pre-merge this anchor identifies the current branch head. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

**STATUS: DRAFT — PENDING EVIDENCE. This lane is NOT approval-ready.** Every row below marked PENDING has not been executed. No unexecuted result is claimed as passing.

## Summary

`public.command_center_game_threads` and `public.command_center_delivery_mappings` exist on production `zfzdnfwdarxucxtaojxm` with real data but have no migration file, no Supabase migration-history entry, and no generated-types entry. They were created out of band against the live database.

This lane captures the exact live DDL so the repository can be replayed from scratch to reach live truth, closing the deny-by-default Live Schema Parity gate for these two relations. Nothing in the migration mutates production: the tables already exist, so on production it is registered as already-applied rather than executed. Every statement is `IF NOT EXISTS` so a scratch replay converges and a re-run is a no-op.

## ASSERTIONS:

- [ ] PENDING — Regenerated `packages/db/src/database.types.ts` contains both Command Center tables and matches production schema truth.
- [ ] PENDING — Live Schema Parity reports no drift for the two relations.
- [ ] PENDING — Shadow parity / schema comparison agrees between repository expectation and production catalog.
- [ ] PENDING — A disposable scratch database replays the migration to the same schema.
- [ ] PENDING — The down script reverses the migration on the scratch database.
- [ ] PENDING — Reapplying the migration after rollback converges to the same schema.
- [ ] PENDING — `pnpm test:db` and writable DB verification pass against staging.
- [ ] PENDING — `pnpm verify` green on the exact head.
- [ ] PENDING — Exact-head independent review.
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
| `pnpm supabase:types` | **PENDING** | Requires production read-only schema introspection. Not executed. |
| Live Schema Parity | **PENDING** | Requires production read-only introspection. Not executed. |
| Shadow parity / schema comparison | **PENDING** | Requires production read-only introspection. Not executed. |
| Scratch replay | **PENDING** | Requires a disposable scratch database. Not executed. |
| Rollback / down-script verification | **PENDING** | Requires a disposable scratch database. Not executed. |
| Reapply + convergence | **PENDING** | Requires a disposable scratch database. Not executed. |
| `pnpm test:db` / writable DB verification | **PENDING** | Staging. Not executed. |
| `pnpm verify` | **PENDING** | Not executed on this head. |
| Exact-head independent review | **PENDING** | Not obtained. |

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

### Known limitations

- Every runtime assertion above is unexecuted and explicitly marked PENDING. Nothing here should be read as proof.
- `information_schema` filters rows by privilege, so a `CONNECT`-only role would silently see fewer objects and report false drift. That is why `REFERENCES` is requested rather than nothing.
