# Credential Purpose Inventory

This inventory is the allowlist for database credentials used by CI, proof, and
production workflows. UTV2-1627 establishes the canonical production Supabase
project fingerprint as `zfzdnfwdarxucxtaojxm`.

The machine-readable writer inventory is
`docs/05_operations/db-writer-classification.json`. CI validates it with
`scripts/ci/db-writer-inventory.ts`; a credentialed DB test or pull-request
workflow that is not classified fails the required `verify` graph.

## Credential purposes

| Credential                                   | Target                                           | Permitted purpose                                                                              | Pull-request write access                                   |
| -------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `CI_SUPABASE_URL`                            | Dedicated non-production Supabase project/branch | Writable DB smoke and T1 proof fixtures                                                        | Yes, only with `UNIT_TALK_DB_ACCESS_MODE=writable-isolated` |
| `CI_SUPABASE_PUBLISHABLE_KEY`                | Same identity as `CI_SUPABASE_URL`               | Client initialization for isolated tests                                                       | Yes                                                         |
| `CI_SUPABASE_SECRET_KEY`                     | Same identity as `CI_SUPABASE_URL`               | Repository/RPC writes inside the isolated target                                               | Yes                                                         |
| `CI_SUPABASE_PROJECT_REF`                    | Same identity as `CI_SUPABASE_URL`               | Non-secret identity fingerprint checked before mutation                                        | Yes                                                         |
| `SUPABASE_URL`                               | Canonical production project                     | Production runtime and explicitly classified observations                                      | No writable PR job                                          |
| `SUPABASE_ANON_KEY`                          | Canonical production project                     | Production client/runtime access                                                               | No writable PR job                                          |
| `SUPABASE_SERVICE_ROLE_KEY`                  | Canonical production project                     | Production API/worker runtime                                                                  | Never supplied to PR proof jobs                              |
| `SUPABASE_DB_URL` / `SUPABASE_DB_POOLER_URL` | Canonical production Postgres                    | Approved production operations, schema observations, and deploy-time DB work                   | No ordinary PR job                                          |
| `SUPABASE_ACCESS_TOKEN`                      | Supabase management plane                        | Approved production operations outside ordinary PR proof workflows                             | Never passed to test or proof processes                     |

`CI_SUPABASE_*` credentials must resolve to one non-production project ref.
Supplying production values under any of those names still fails because the
guard fingerprints the actual URL, host, database URL, and declared project
ref. Missing mode or identity configuration also fails before a test process is
spawned.

## Pull-request workflow allowlist

| Workflow                                       | Mode                                             | Workflow → command → DB reachability                                                                                         |
| ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                     | `writable-isolated`                              | `staging-db-proof` → `pnpm ci:db-smoke` / T1 suites → signed receipt; credential-free `verify` validates the receipt          |
| `.github/workflows/proof-gate.yml`             | `writable-isolated`                              | `t1-proof` → `pnpm ci:db-smoke` → `pnpm test:db` → repository/service-role clients → isolated canonical tables               |
| `.github/workflows/t1-proof-gate.yml`          | `writable-isolated`, manual-only legacy workflow | `workflow_dispatch` → `pnpm ci:db-smoke` → `pnpm test:db` → isolated canonical tables                                        |
| `.github/workflows/proof-regression.yml`       | `writable-isolated`                              | affected writable proof scripts → `pnpm ci:assert-staging` → staging-only execution                                         |
| `.github/workflows/shadow-parity-required.yml` | `control-only`, fail-closed                      | no production credential; blocks until a mechanically read-only production role is provisioned                              |
| `.github/workflows/proof-coverage-guard.yml`   | `control-only`                                   | static writer inventory and proof-path classification; receives no DB credential                                             |

Production-read-only entrypoints are enumerated exactly in
`db-writer-classification.json`. The inventory validator rejects `.insert()`,
`.update()`, `.upsert()`, `.delete()`, repository save/record/enqueue calls, and
other known mutation signals in those sources.

## Writable suite ownership

All credentialed tests discovered under `apps/**` are enumerated in
`db-writer-classification.json` with their owning app and exact package-script
or manual command. They are conservatively classified as
`writable-isolated`, including query-only tests, so no credentialed test may be
aimed at production merely because its current assertions appear read-only.

The recurring writable graph is:

1. `pnpm test:db` → `apps/api/src/database-smoke.test.ts`.
2. `pnpm test:t1-proof:live` → the explicit API, ingestor, and worker proof
   files in `package.json`.
3. `pnpm test:live-db` → both suites above.
4. `pnpm verify` → static verification, then `pnpm test:live-db`.

The UTV2-1497 concurrent-claim canary additionally invokes the canonical privileged-client boundary
inside its own `before` hook. Its picks and outbox rows may persist only in the
isolated target; production cleanup-by-delete is not a safety mechanism.

## Fail-closed rules

- A writable process with missing `UNIT_TALK_DB_ACCESS_MODE`,
  `CI_SUPABASE_PROJECT_REF`, URL, or credentials does not run.
- A target containing production ref `zfzdnfwdarxucxtaojxm` is rejected before
  repository construction, regardless of environment variable name.
- A declared ref that differs from the ref observed in the URL is rejected.
- A new credentialed test or pull-request DB workflow fails inventory
  validation until it has an owner, execution path, and access classification.
- Generic production Supabase secrets are forbidden in every
  `writable-isolated` workflow.
- Existing production rows are never cleaned up, updated, quarantined, or
  backfilled by this control.
