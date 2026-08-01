# PROOF: UTV2-1633 — least-privilege read-only Postgres role for diagnostics and reporting

MERGE_SHA: b256bce5df9a9afb307ecef37b2d575624fabd4b

> **Lane status: STARTED, PR NOT YET MERGED, PRODUCTION APPLICATION BLOCKED.**
> `MERGE_SHA` above is the implementation-commit SHA (per
> `executor-result-validator.yml`'s documented allowance: "proof files to
> reference the implementation commit SHA rather than their own commit SHA" —
> it will be rebound to the real squash-merge SHA post-merge by
> `post-merge-lane-close.yml` via `ops:proof-generate --merge-sha`).
>
> **This proof bundle cannot yet contain the mandated negative/positive
> production demonstration.** Read this section before anything else below.
>
> Verified read-only against production `zfzdnfwdarxucxtaojxm` and staging
> `xskgrzbteyqdufktjrjx` (2026-08-01): schema `reporting` does not exist in
> either database. UTV2-1399 ("reversible, fixture-excluding production
> reporting view") merged to `main` (PR #1343, squash SHA `fdc19358`) and its
> own lane manifest reads `status: done` — but its migration
> (`supabase/migrations/20260731000000_utv2_1399_fixture_excluding_reporting_views.sql`)
> has never actually been applied to production or staging. Confirmed three
> independent ways: `pg_namespace` has no `reporting` row in either database;
> `supabase_migrations.schema_migrations` (production) tops out at
> `20260714231357_bootstrap_delivery_kill_switch_posture`, one migration prior
> to UTV2-1399's; and the same check against staging shows only the 3-row
> baseline set for that project (created 2026-07-30 for UTV2-1630/1631's
> isolated CI staging cutover). "Merged to main" and "applied to the live
> database" are different facts in this repo, and only the second one is true
> for the schema this lane's grants target.
>
> This migration's own required proof (issue text: "A negative demonstration
> … A positive demonstration … captured via the Supabase MCP `execute_sql`
> tool against production") is not achievable until `reporting` exists on
> production, which requires UTV2-1399's migration to be applied first, and
> then this lane's own migration applied on top.
>
> Per `docs/05_operations/DB_MIGRATION_WORKFLOW.md` ("Agent Operational
> Rules"): *"Agents must not: Run `supabase db push` without explicit operator
> instruction in the current session… Apply any migration that the operator
> has not reviewed in the current session."* No such instruction was given in
> this session for either UTV2-1399's migration or this lane's own migration.
> This is the same rule UTV2-1399's own `EXECUTOR_RESULT` comment on PR #1343
> cites for why it never ran `supabase db push` itself: *"Regeneration +
> `supabase db push` are post-merge operator steps … (agents may not run
> `supabase db push`)."*
>
> This is a hard governance boundary, not a discretionary judgment call, and
> it is stricter than this lane's delegated T1 **merge** authority (which
> covers approving/merging the PR, not applying DDL to a live database). It is
> also consistent with this lane's own explicit hard boundary: *"No production
> writes beyond the reviewed, merged migration itself"* — and the migration
> is not yet reviewed-and-merged, so no production write of any kind has been
> made in this lane.
>
> **What this means concretely:** the migration, rollback, and guard test
> below are complete and locally verified. The PR can proceed through CI and
> review. The database-level negative/positive demonstration and the
> after-state privilege dump are the two required-proof items that remain
> genuinely blocked pending an explicit operator decision — see
> "BLOCKED — required proof not yet obtainable" below for the exact two
> commands that would unblock it and who needs to run them.

---

## Required implementation — status

| Requirement (from the issue) | Status |
|---|---|
| `CONNECT` on the database, `USAGE` on schema it must read | Implemented |
| `SELECT` only — no INSERT/UPDATE/DELETE/TRUNCATE, no CREATE, no role admin | Implemented; mechanically enforced by the guard test |
| `DEFAULT PRIVILEGES` scoped so future `reporting` tables don't over-grant | Implemented |
| Explicit grant on `reporting.*` using UTV2-1399's prescribed statements | Implemented, verbatim |
| No access to secrets-bearing or auth schemas beyond a reporting consumer | Implemented — zero grants outside schema `reporting` |
| Negative demonstration (real DB error output) | **Blocked** — see above |
| Positive demonstration (real query result) | **Blocked** — see above |
| `information_schema`/`pg_catalog` privilege dump, before and after | Before: captured below (production, read-only). After: **blocked** |
| Migration recorded in the ledger, replayable | Implemented — see "Static proof" |

---

## Grant statements used (exact, from the migration)

```sql
GRANT CONNECT ON DATABASE postgres TO reporting_reader;
GRANT USAGE ON SCHEMA reporting TO reporting_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO reporting_reader;
```

These are the three statements UTV2-1399's own proof (`docs/06_status/proof/UTV2-1399/verification.md` §10) prescribed for this lane, verbatim, plus the explicit `CONNECT` grant the issue text also requires. `reporting_reader` is created `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` — every Postgres role-administration attribute explicitly denied, not merely left at an implicit default, so the privilege set is self-describing without cross-referencing Postgres's default-attribute table.

No grant of any kind is issued on schema `public`, `auth`, `vault`, `storage`, or `extensions`. Mechanically enforced by `scripts/ci/utv2-1633-reporting-reader-role-guard.test.ts`.

---

## Before-state privilege dump (production, read-only, captured 2026-08-01)

Measured via Supabase MCP `execute_sql` against `zfzdnfwdarxucxtaojxm`. All statements below are `SELECT` only; no DDL was applied and no row was created, updated, or deleted.

```sql
SELECT current_database();
-- postgres

SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY nspname;
-- auth, cron, extensions, graphql, graphql_public, information_schema, public,
-- realtime, storage, supabase_migrations, vault
-- (no "reporting" schema — confirms UTV2-1399's migration is not yet live)

SELECT rolname FROM pg_roles WHERE rolname = 'reporting_reader';
-- (zero rows — role does not exist yet)

SELECT datacl FROM pg_database WHERE datname = current_database();
-- {=Tc/postgres,postgres=CTc/postgres,supabase_etl_admin=C/postgres,
--   supabase_storage_admin=C/postgres,dashboard_user=CTc/postgres}
-- PUBLIC (the "=" entry) already holds Tc — TEMP and CONNECT — on this
-- database. This is a pre-existing Supabase-project default, not introduced
-- by this migration; the explicit GRANT CONNECT in this migration is
-- deliberately redundant with it for self-documentation (see migration
-- header comment).

SELECT nspname, nspacl FROM pg_namespace
WHERE nspname IN ('public','auth','vault','storage','extensions')
ORDER BY nspname;
```

```text
auth       | {supabase_admin=UC/supabase_admin,anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin,supabase_auth_admin=UC/supabase_admin,dashboard_user=UC/supabase_admin,postgres=U/supabase_admin}
extensions | {postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,service_role=U/postgres,dashboard_user=UC/postgres}
public     | {pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,postgres=U/pg_database_owner,anon=U/pg_database_owner,authenticated=U/pg_database_owner,service_role=U/pg_database_owner}
storage    | {supabase_admin=UC/supabase_admin,postgres=U*/supabase_admin,anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin,supabase_storage_admin=U*C*/supabase_admin,dashboard_user=UC/supabase_admin}
vault      | {supabase_admin=UC/supabase_admin,postgres=U*/supabase_admin,service_role=U/supabase_admin}
```

**Reading this dump:**
- `public` carries a bare `=U/pg_database_owner` entry — the `=` (empty
  grantee) means **PUBLIC** already has `USAGE` on schema `public` in this
  project. This is pre-existing and not introduced by this migration.
  `USAGE` on a schema does **not** confer `SELECT` on any table inside it —
  it only allows a role to reference (look up) objects in the schema. Every
  `public.*` table has RLS enabled and `reporting_reader` receives **no**
  table-level grant there, so `SELECT` on any `public.*` relation fails with
  `permission denied for table …` regardless of this schema-level `USAGE`
  PUBLIC already grants everyone.
- `auth`, `vault`, `storage`, `extensions` grant `USAGE` only to named,
  privileged roles (`supabase_admin`, `supabase_auth_admin`,
  `supabase_storage_admin`, `anon`, `authenticated`, `service_role`,
  `postgres`, `dashboard_user`) — **no PUBLIC entry** on any of them.
  `reporting_reader` is not on any of those lists and this migration adds it
  to none of them, so it has zero implicit or explicit path into any of
  these four schemas.
- `reporting` has no row at all yet (schema does not exist).

This before-state dump will be re-captured after production application to
form the required "before/after" pair; the after half is one of the two items
blocked (see below).

---

## BLOCKED — required proof not yet obtainable

Two production DDL applications are needed, in this order, before the
negative/positive demonstration and after-state dump can be captured:

1. **UTV2-1399's own migration** —
   `supabase/migrations/20260731000000_utv2_1399_fixture_excluding_reporting_views.sql`
   — already reviewed, merged, and closed as a lane, but never applied to a
   live database. This is a prerequisite of this lane, not this lane's own
   change.
2. **This lane's migration** —
   `supabase/migrations/20260801000000_utv2_1633_reporting_reader_role.sql`
   — after this PR is reviewed and merged.

Both require `supabase db push` (or equivalent — Supabase MCP
`apply_migration`), and per `docs/05_operations/DB_MIGRATION_WORKFLOW.md` an
agent may not run either without **explicit operator instruction in the
current session**. No such instruction has been given for either migration in
this session.

**What unblocks this:** the human operator either (a) runs
`supabase db push --project-ref zfzdnfwdarxucxtaojxm` for both migrations (in
order) themselves and this lane then captures the read-only demonstration
against the now-live role, or (b) explicitly instructs the agent, in-session,
to run the push for one or both. Once `reporting_reader` exists in
production, the remaining proof is mechanical and fast: `SET ROLE
reporting_reader` inside a read-only Supabase MCP session, then attempt one
representative write on `public.picks` (expect a real Postgres "permission
denied" error) and one representative read on `reporting.picks` (expect a
real row count), then re-run the privilege dump above for the after-state.

Nothing about the migration's *content* is blocked — it is fully drafted,
locally verified, and passed its own guard test (below). Only the live
database application, and everything downstream of it, is blocked.

---

## Static proof

```text
$ npx tsx --test scripts/ci/utv2-1633-reporting-reader-role-guard.test.ts
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ npx eslint scripts/ci/utv2-1633-reporting-reader-role-guard.test.ts
=== ESLINT EXIT: 0 ===

$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
=== TYPECHECK EXIT: 0 ===

$ node scripts/lint-migrations.mjs
[lint-migrations] 4 migration file(s) checked — no findings.

$ node scripts/check-migration-versions.mjs
[check-migration-versions] 5 migration file(s) verified — no duplicate versions.

$ npx tsx scripts/ci/migration-reversibility-gate.ts --base origin/main
  [PASS] supabase/migrations/20260801000000_utv2_1633_reporting_reader_role.sql
migration-reversibility-gate: PASS

$ npx tsx scripts/ci/r-level-check.ts --base origin/main
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

**Guard test intent:** mechanically enforces every promise in this proof —
`reporting_reader` is `NOLOGIN` with every role-administration attribute
explicitly denied; every `GRANT`/`ALTER DEFAULT PRIVILEGES` statement targets
only schema `reporting` and only `SELECT`/`USAGE`/`CONNECT`, never
`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`CREATE`/`ALL`, and never references
schema `public` or any `public.*` relation; the migration fails closed if
schema `reporting` is missing; the migration verifies its own grant set
in-transaction before committing; the rollback drops the role and revokes
every grant without ever touching schema `reporting` itself (owned by
UTV2-1399, not this lane); the migration creates no schema object of any
kind other than the role. Per CLAUDE.md invariant 11: if a rule can be
enforced mechanically, it must not live only in prose.

**`pnpm test:db` / `pnpm test:ops` / full `pnpm verify`:** not run standalone
from this host — `ci:assert-staging` correctly refuses any non-staging
target, and this lane does not touch `package.json` (see "package.json
conflict" below), so the guard test is not yet wired into the `test:ops`
list. CI's own `verify` and `T1 Proof Gate` runs are the authoritative
signal for these, on the PR's actual head.

**`package.json` conflict, recorded not fixed:** this lane's guard test is
not added to the `test:ops` script list in `package.json` in this PR.
`package.json` is a singleton-only path
(`scripts/ops/lane-start.ts` `SINGLETON_ONLY_FILES`), and at lane-start time
it was held by UTV2-1624's lane manifest (status `in_progress` on
`origin/main`) — a ghost lock: UTV2-1624's PR (#1338) had already merged
(commit `43c36112`), but its lane-close had not yet run, and a separate PR
(#1349, `codex/utv2-1624-runtime-proof-repair`) was open specifically to
repair that closeout. Rather than touch `package.json` — which would either
collide with that in-flight repair or require reconciling another issue's
lane as a side effect of this one — this lane declares no `package.json`
scope at all and does not wire its guard test into `pnpm test`'s automatic
run. The guard test is still fully written and passes standalone (above);
wiring it into `test:ops` is a trivial follow-up once `package.json`'s lock
is free, in the same spirit as UTV2-1399 deferring
`packages/db/src/database.types.ts` regeneration to a post-merge step.

---

## Reversibility

`db/migrations-rollback/20260801000000_utv2_1633_reporting_reader_role.down.sql`
revokes every privilege this migration grants (`ALTER DEFAULT PRIVILEGES …
REVOKE`, `REVOKE SELECT … FROM reporting_reader`, `REVOKE USAGE … FROM
reporting_reader`, `REVOKE CONNECT … FROM reporting_reader`), then
`DROP OWNED BY reporting_reader` (belt-and-suspenders — a no-op once the
explicit REVOKEs have already run) and `DROP ROLE IF EXISTS
reporting_reader`. It asserts, in-transaction, that the role is actually gone
and that schema `reporting` still exists (this rollback must never remove or
depend on removing that schema — it belongs to UTV2-1399, not this
migration). Not marked `IRREVERSIBLE`; correctly absent from
`db/migrations-rollback/irreversible-exemption-registry.json`.

The CI round-trip drill (`migration-reversibility-gate.yml`,
`schema-roundtrip-drill` job) replays the full migration ledger on a scratch
`postgres:16` container in order, so UTV2-1399's migration runs as an
established "baseline" migration before this one in that drill — the
`reporting` schema this migration depends on will exist in that scratch
environment regardless of production's current state. That drill's
`pg_dump --schema-only --schema=public --no-acl` comparison also does not
capture roles, grants, or the `reporting` schema at all, so this migration
(role + grants only, zero `public` schema objects) is expected to be
schema-hash-neutral in that check — round-trip verification for this
specific migration rests on the up/down SQL applying without error, not on
detecting a `public`-schema difference that could never exist here.

---

## Adjacent finding — Live Schema Parity (not this lane's to fix)

Per UTV2-1399's own recorded finding, `Live Schema Parity` fails repo-wide on
78 pre-existing `missing_in_expected` findings for
`command_center_game_threads`/`command_center_delivery_mappings` — unrelated
ledger drift, advisory only (not one of the four required contexts), and
hard-scoped to schema `public`. This migration creates a role and grants —
zero `public`-schema objects — so it adds nothing to that count. Confirmed,
not touched.

## Not closed in this lane

- Production negative/positive demonstration and after-state privilege dump —
  blocked on operator-authorized `supabase db push` for both UTV2-1399's
  prerequisite migration and this lane's own migration (see "BLOCKED" above).
- `pnpm test:db` / full `pnpm verify` / `pnpm test:ops` — not run locally;
  CI is authoritative.
- Guard test not wired into `package.json`'s `test:ops` list — blocked on a
  concurrent lane's (UTV2-1624) file-scope lock; deferred as a trivial
  follow-up.
- PR open/merge, `t1-approved` label, `pm-verdict/v1`, and final closeout
  (`ops:lane-finalize`, `ops:lane-close`) not yet complete as of this
  snapshot.
- This role is not granted to any login/service credential and is not wired
  into any live application — by design, out of this lane's scope, a
  separate governed action requiring explicit PM authorization.
