# UTV2-1981 — diff summary

Execution SHA: `1741d71b9ce5b640a179f83412cccdc20d1d0e5d`. Merge SHA: pending governed merge.

The repo migration now guards the index name before DDL, then runs ordinary
`CREATE INDEX IF NOT EXISTS picks_updated_at_idx ON public.picks (updated_at)`.
It accepts only a valid, ready, live, nonunique btree with exactly one column,
updated_at, no expression or predicate. Collisions raise SQLSTATE 42P07. The down
script is exactly `DROP INDEX IF EXISTS public.picks_updated_at_idx;`.

Production builds the index first out of band with CIC under Griff's separate
authorization, then the repo migration validates it as a no-op and records history.
The production apply packet contains session budgets, catalog checks, locks,
monitoring, failure cleanup, concurrent rollback and post-deploy parity ordering.

Restored `.ops/work/UTV2-1981.md` byte-for-byte from `9ac405e77` and preserved the
ratified sync manifest at `851b17faf`. No application code, retry policy, timeout,
test file, generated type, drill, gate or proof schema changed. No tests removed
or new any casts. Existing lane metadata remains in the branch.

CI scratch precondition and schema round-trip jobs pass at the implementation SHA.
Local scratch PostgreSQL additionally refuses INVALID, wrong-column, partial,
unready, unique, expression, included-column and wrong-table indexes, and accepts
a valid matching index as a no-op. Exact commands and results: `verification.md`.

Live DDL, staging performance evidence, PM approvals, merge and lane finalization
remain outside executor completion. See `evidence.json` and `verification.md` for
measured gate status and exact CI receipts; no READY_FOR_REVIEW is published.
