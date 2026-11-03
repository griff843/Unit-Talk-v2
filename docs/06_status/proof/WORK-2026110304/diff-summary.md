# WORK-2026110304 diff summary

Calendar From dates now use UTC midnight; calendar To dates use exclusive next UTC midnight, including microsecond timestamps. Invalid calendar dates reject before query/result short circuits. Full timestamps retain exact gte/lte behavior. The same normalized bounds apply to rows and counts.

- `apps/command-center/src/lib/data/queues.ts`: normalize and validate bounds once before applying shared filters.
- `apps/command-center/src/lib/data/queues-count-relation.test.ts`: row/count predicate parity, leap/year rollover, exact timestamps, invalid From/To and empty result-filter regression.
- `apps/command-center/src/lib/describe-error.ts`: fixed actionable operator messages for permission, session, timeout, network and generic failures; preserve describeThrown.
- `apps/command-center/src/lib/describe-error.test.ts`: classification and diagnostic non-disclosure regressions, preserving diagnostic-helper coverage.

Only four implementation/test files changed. The four named proof files are explicitly required by the packet. Existing lane scaffolding predates this implementation. Focused test count increases from 20 on main to 38; no new any casts. No UI component, route, layout, styling, schema, migration or data-write change.

Source SHA: 43471d7b44505212b5a251e8484346312b76d0ae
Merge SHA: pending merge
PR: deferred to Production Claude by packet sequencing.
