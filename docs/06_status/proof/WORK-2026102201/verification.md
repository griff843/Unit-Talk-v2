# PROOF: WORK-2026102201 — Verification

MERGE_SHA: pending merge

> This is pre-merge executor evidence. It does not claim staging proof, PM
> approval, merge, production migration, deployment, lane finalization, or
> canonical post-merge closeout.

Issue: WORK-2026102201
Tier: T1
Lane type: migration
Proof profile: migration
Execution SHA: `aa83590a8a98e366c3bf502e68d176b490011860`
Verified source SHA: `aa83590a8a98e366c3bf502e68d176b490011860`
result: blocked_pending_staging_and_reversibility_scope

## ASSERTIONS:

- [x] One transaction sets `security_invoker = true`, revokes all privileges
      from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grants
      `SELECT` to `service_role` only.
- [x] The migration documents the exact recovery SQL and a reusable
      `has_table_privilege` query covering all seven view privileges for
      `anon`, `authenticated`, and `service_role`.
- [x] Static tracing confirms every named reader selects through a service-role
      client: the API board route constructs a service-role connection; the
      market-family service receives that repository; Command Center's
      authenticated data client constructs a service-role connection; and the
      Phase 6 proof script requires `SUPABASE_SERVICE_ROLE_KEY`.
- [x] Static verification and focused service-role/client tests pass.
- [x] No production DDL or data mutation was executed.
- [ ] Staging before/apply/recovery/reapply privilege snapshots and reader
      executions remain deferred to protected staging CI.
- [ ] The repository migration-reversibility gate requires a separate down
      script outside this packet's two-file scope; the documented recovery has
      therefore not yet passed the governed round-trip drill.

## EVIDENCE:

```text
pnpm verify:static: PASS
pnpm verify: STATIC PASS, then expected staging-target REFUSAL before DB access
pnpm lint:migrations: PASS (139 forward migrations checked; no findings)
market-family-trust-service.test.ts: 8 pass, 0 fail
command-center client.test.ts: 5 pass, 0 fail
privileged-client-boundary.test.ts: 17 pass, 0 fail
R-level check: PASS; tool reported 16 changed-file records; no rules matched
pnpm test:db: REFUSED before query/write (host=127.0.0.1, ref=unidentified;
  expected staging xskgrzbteyqdufktjrjx)
migration-reversibility-gate: FAIL; required out-of-scope path is
  db/migrations-rollback/20261022090000_revoke_governed_pick_performance_anon.down.sql
ops:exec-checkpoint: BLOCKED; execution_checkpoint_missing because neither the
  primary checkpoint nor its sidecar exists for the supplied execution epoch
```

Static reader provenance:

```text
apps/api/src/routes/board.ts -> createServiceRoleDatabaseConnectionConfig(env)
apps/api/src/market-family-trust-service.ts -> injected governedPerformance repository
apps/command-center/src/lib/data/client.ts -> createServiceRoleDatabaseConnectionConfig(env)
apps/command-center/src/lib/data/board.ts -> getDataClient()
apps/api/src/scripts/utv2-481-phase6-proof.ts -> SUPABASE_SERVICE_ROLE_KEY
```

## Verification

- `pnpm supabase:types`: BLOCKED before connection because
  `supabase/.temp/project-ref` is absent. The required worktree helper then
  refused this nested worktree as the main checkout; no metadata was copied and
  generated types remained unchanged. The migration changes no row shape.
- `pnpm verify:static`: PASS, including lint, type-check, build, root tests,
  production-post-migration verifier tests, Smart Form verification, command
  manifest validation, migration version validation, and migration lint.
- `pnpm verify`: the complete static phase passed again, then the canonical
  live-DB phase was refused before database access because the available target
  was `127.0.0.1/unidentified`, not sanctioned staging. Exit 1 is the expected
  fail-closed disposition, not a static-test failure.
- `pnpm exec tsx --test apps/api/src/market-family-trust-service.test.ts`:
  PASS (8/8).
- `pnpm exec tsx --test apps/command-center/src/lib/data/client.test.ts`:
  PASS (5/5 after the required build produced package `dist` artifacts).
- `pnpm exec tsx --test packages/db/src/privileged-client-boundary.test.ts`:
  PASS (17/17).
- `pnpm test:db`: correctly REFUSED before any database test or mutation because
  the target resolved to `127.0.0.1/unidentified`, not sanctioned staging.
- `pnpm exec tsx scripts/ci/migration-reversibility-gate.ts --base origin/main --json`:
  FAIL because the repository gate requires the out-of-scope down script named
  above. The authoritative packet permits either a rollback migration or a
  documented recovery statement, but its allowed scope contains no rollback path.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
  PASS; the tool reported 16 changed-file records and no matching rules.
- `pnpm ops:scope-diff -- --issue WORK-2026102201`: PASS while the migration
  was the uncommitted implementation delta; after the required proof artifacts
  were committed, the command inspected the proof-only tip and reported those
  three required evidence paths as bleed. The packet explicitly requires those
  artifacts, so they were retained and the discrepancy is surfaced for the
  governed reviewer.
- `pnpm ops:exec-checkpoint phase-complete ...`: BLOCKED by
  `execution_checkpoint_missing`. The supplied epoch
  `3136a4d3-0334-4673-b62a-2ead37699b22` has neither its primary checkpoint
  nor a sidecar, so no phase completion was fabricated.

Writable live-DB proof is blocked/deferred: target identity could not be
resolved as sanctioned staging. Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with
`CI_SUPABASE_*` credentials. The staging job must capture effective privileges
before apply, after apply, after recovery, and after reapply, then run the API
board reader, market-family tuning reader, Command Center board reader, and
Phase 6 proof script with the service-role key.

## Pending governed evidence

- Authorize `db/migrations-rollback/20261022090000_revoke_governed_pick_performance_anon.down.sql`
  in the lane scope, or provide a governed exception compatible with the
  repository reversibility gate.
- Run the privilege/recovery/reader proof in protected staging CI.
- Obtain independent PM review and merge approval.
- After merge and separate Griff authorization, apply production DDL through
  the sanctioned path and complete production read-only verification.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: aa83590a8a98e366c3bf502e68d176b490011860
