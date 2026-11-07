# UTV2-1981 — diff summary

Execution SHA: `c8820ba7a21034475bcadb57f0454e7eb4083fc6`. Merge SHA: pending governed merge.

Adds one standalone `CREATE INDEX CONCURRENTLY picks_updated_at_idx ON
public.picks USING btree (updated_at)` and a concurrent down script. Native
name-collision failure avoids silently accepting a wrong or invalid index.
No application behavior, retry policy, timeouts, contracts, or pick data change.
No new tests or `any` casts; no tests removed.

The production apply design requires standalone autocommit, explicit target
identity, valid/ready catalog proof, representative before/after plans, actual
8-second-budget PostgREST guard runs, and separate Griff production authorization.
Live proof is deferred; no production or staging DDL executed.

Files authored: the migration, its rollback, `.ops/work/UTV2-1981.md`, the production
apply packet and the four required proof artifacts in this directory. The branch
already contains lane setup metadata; its initial dirty sync edit is preserved
and excluded from implementation commits. Captured packet hash:
`94b1284e5d9506043b30d4d7a861b5b2b4328204ddcc0ec311465f000cdfe27b`.

R-level rules inspected: no matching paths in
`docs/05_operations/r1-r5-rules.json`; required check passed. Down-script presence
passed for one migration. Focused suite passed 135/135; see verification.md for
aggregate results and environmental blockers.

Final static verification: `pnpm verify:static` PASS, `pnpm type-check` PASS,
`pnpm test` PASS (7,868 passed, 13 skipped, 0 failed). Full `pnpm verify`
BLOCKED after its passing static stage by the staging identity guard.
