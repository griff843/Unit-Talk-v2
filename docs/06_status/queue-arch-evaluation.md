# Queue Architecture Evaluation

## Summary

`UTV2-932` adds a benchmark harness at `scripts/benchmarks/queue-throughput.ts` to evaluate the current Postgres-backed queue model without requiring a live database during CI or `pnpm verify`. The harness emits a JSON summary with claim-latency, throughput, retry-rate, and dead-letter-rate metrics, and it defaults to dry-run mode unless a non-production `DATABASE_URL` is supplied with explicit live intent.

The current architecture remains viable while queue depth is moderate, claim latency stays low under burst load, and retry or dead-letter behavior remains operationally explainable. A dedicated queue should be considered only when benchmark evidence and observability both show that Postgres queue semantics are becoming a bottleneck rather than an implementation convenience.

## Benchmark Methodology

The benchmark is split into two modes:

1. Dry-run mode
   Used by default when `DATABASE_URL` is absent. It runs a deterministic workload model in process, simulates worker claims against a bounded backlog, and validates metric-shape safety for CI.
2. Live mode
   Enabled only with `DATABASE_URL` plus `--live` or `--allow-live`. It is guarded against the production Supabase project and is intended for a local or cloned Postgres instance only. The harness executes SQL through `psql`, generates a synthetic queue workload, and returns JSON aggregates to stdout.

Measured outputs:

- Claim latency: synthetic row creation timestamp to worker-claim timestamp
- Processing throughput: completed rows per second for the configured workload
- Retry rate: retryable failures divided by claimed rows
- Dead-letter rate: terminal failures divided by claimed rows
- Pending carryover: rows left unclaimed or reintroduced by retries
- Contention ratio: worker claim demand relative to successful claims

Recommended execution pattern for non-production validation:

```bash
tsx --test scripts/benchmarks/queue-throughput.test.ts
tsx scripts/benchmarks/queue-throughput.ts
DATABASE_URL=postgresql://bench@localhost:5432/unit_talk tsx scripts/benchmarks/queue-throughput.ts --live --batch-size=500 --worker-count=8 --claims-per-worker=80
```

## Thresholds

The following thresholds are practical decision points rather than automatic migration triggers:

- Pending count: sustained backlog above `5,000` pending rows during normal traffic should trigger a focused capacity review.
- Claim latency: p95 claim latency above `250 ms` in repeated live runs suggests lock acquisition and queue scan costs are no longer trivial.
- Contention level: contention ratio above `0.25` under expected worker concurrency suggests workers are oversubscribed relative to claim success.
- Retry rate: sustained retry rate above `10%` should be treated as an operational health issue before it is treated as a queue-technology issue.
- Dead-letter rate: sustained dead-letter rate above `1%` should block any migration discussion until delivery-failure attribution is clean.

At a minimum, a dedicated queue evaluation should start when two or more of the following are simultaneously true for repeated live runs on a non-production clone:

- pending rows remain above `5,000`
- p95 claim latency remains above `250 ms`
- contention ratio remains above `0.25`
- throughput does not scale proportionally after worker-count increases

## Decision Criteria

Postgres-as-queue is sufficient when:

- worker claim latency is low and stable
- queue depth clears predictably after bursts
- retries and dead letters map to downstream delivery behavior rather than claim-path contention
- operational tooling can explain stuck, retried, and dead-lettered work quickly
- benchmark throughput scales acceptably with modest worker-count increases

Migration to a dedicated queue should be considered when:

- claim latency grows with backlog even on tuned indexes and bounded worker concurrency
- queue scans or claim contention become a measurable contributor to delivery delay
- throughput stops scaling before hardware or DB tuning limits are reached
- retry and replay flows need semantics that are cumbersome in relational storage
- operational separation between transactional writes and delivery scheduling becomes more important than current implementation simplicity

The migration decision should not be based on row count alone. If Postgres continues to provide predictable claim behavior, explainable failure semantics, and sufficient throughput for peak workloads, it is still the lower-complexity option.

## Observability Gaps That Must Be Filled Before Migration

Before a safe queue migration, these gaps need to be closed:

- per-claim latency histograms from real worker claims, not only aggregate queue health snapshots
- explicit visibility into queue scan time versus delivery execution time
- worker contention metrics tied to claim attempts, empty claims, and lock conflicts
- retry-cause classification that separates downstream transport failures from queue-claim path failures
- replay and dead-letter auditability that remains comparable before and after migration
- stable saturation alerts for backlog growth, oldest-pending age, and claim-latency regressions
- a benchmark history trail so migration decisions are based on trend data rather than one-off spot checks

Without those signals, a queue migration risks replacing a known operational model with a less observable one.

## R-level Compliance

N/A — no lifecycle, domain, strategy, or UI runtime paths were changed. This lane adds a benchmark script and a status document only.
