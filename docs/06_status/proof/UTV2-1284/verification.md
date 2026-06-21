# UTV2-1284 — Verification

Harden the ingestor daemon so a transient DB outage can never leave it
"daemon-dead / process-alive". Tier T1. `apps/ingestor` + the production compose
healthcheck — no schema change, no migration.

## Proven root cause (production, 2026-06-20)

The ingestor went dark for ~5.5h (16:48 → 22:26 UTC) after the prior deploy. Host
logs (`ssh unit-talk-prod`, `docker logs unit-talk-ingestor-1`) + `system_runs`
showed 148 log lines then **zero logs and zero completed cycles**, while the
container reported "healthy". The terminal log sequence:

```
cycle=1 league=MLB TIMEOUT after 240000ms — failing closed ... (UTV2-1280/1282)
finalized-repoll league=MLB candidates=23
league=MLB failed, skipping to next: Failed to upsert provider cycle status: undefined
league=NHL failed, skipping to next: Failed to start system run: unknown error
error: "Failed to list started events: supabase.co | 521: Web server is down" @16:48:43
```

Mechanism: the daemon is a single `runIngestorCycles` call with `maxCycles=Infinity`
(index.ts). The per-**league** work is guarded, but the per-**cycle** body after it
(`runFinalizedRepollsForCycle` → `events.listStartedBySnapshot`) was **unguarded**.
A transient **Supabase 521** made that call throw; the rejection escaped the infinite
for-loop to the promise `.catch`, which set `process.exitCode = 1` **without exiting**.
The loop was dead, the process lingered, and the healthcheck `pgrep -f 'node'` proved
only that a node process existed — so Docker never restarted it.

## What changed

1. **Resilient poll loop** (`ingestor-runner.ts`) — the per-cycle body is wrapped in
   try/catch. A transient cycle-level failure fails the iteration closed, emits
   `POLL ITERATION FAILED — daemon continuing to next poll (fail-closed, UTV2-1284)`
   telemetry, and falls through to the next poll. The inter-cycle `sleep` moved
   outside the try so the loop always advances.
2. **Loop-progress healthcheck** (`heartbeat.ts`, `healthcheck.ts`, `index.ts`,
   `deploy/production/docker-compose.yml`) — the loop stamps a per-cycle heartbeat
   file; the container healthcheck (`tsx apps/ingestor/src/healthcheck.ts`) fails when
   the heartbeat is stale, replacing the `pgrep -f node` no-op. An in-process watchdog
   force-exits on a stale heartbeat so `restart: unless-stopped` recreates the
   container — eliminating the daemon-dead/process-alive state (plain compose does not
   auto-restart on `unhealthy`, so the watchdog's `process.exit` is what drives the
   restart; the healthcheck makes the signal true and supports any future autoheal).
3. **Bounded league re-admission** (`ingestor-runner.ts`) — a timed-out league whose
   orphaned work never settles is force-released and re-admitted after `leagueReadmitMs`
   (default 2× `leagueTimeoutMs`) instead of being skipped forever; every skip logs
   its reason.

The ingestor still only writes provider/event tables; no business logic, no
freshness-gate change, no backfill, no public-delivery change.

## Verification

### Static gates (`pnpm verify:parallel`)

`[verify:parallel] all checks passed` — env:check, lint, type-check (project
references), build (all packages + apps), and the full unit suite all green.

### Focused — `apps/ingestor/src/ingestor-loop-resilience.test.ts` (3/3)

```
ok 1 - FIX #1: a transient cycle-level DB failure does not kill the daemon loop (UTV2-1284)
ok 2 - FIX #1: the heartbeat hook throwing never breaks the loop (UTV2-1284)
ok 3 - FIX #3: a timed-out league held past the re-admission bound is re-admitted (UTV2-1284)
```

Test 1 reproduces the exact outage: `events.listStartedBySnapshot` throws a 521;
before the fix `runIngestorCycles` rejects (loop dies), after the fix it resolves,
logs the fail-closed telemetry for each cycle, and the heartbeat advances.

### Focused — `apps/ingestor/src/heartbeat.test.ts` (7/7)

```
ok 7 - runHealthcheck exits 0 on a fresh heartbeat and 1 when stale (process alive, loop wedged)
```

Proves the healthcheck fails when the loop heartbeat is stale even though the node
process is alive — the failure mode `pgrep node` could never detect.

### Regression — existing ingestor suites green

`ingestor-cycle-singleton.test.ts` 4/4 (singleton semantics changed from boolean to
timestamped map) and `ingestor.test.ts` 86/86.

### Runtime — `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)

Executed `pnpm test:db` against the live database — **7/7 pass** (database-smoke.test.ts,
duration ~114s). Confirms the runtime DB invariants hold for this branch (read-only;
the ingestor change adds no schema and no new writes).

```
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 114316.597382
```

### Live recovery (read-only, prod)

Operational restart of the wedged ingestor at 22:26 UTC reaped 7 hung singletons and
resumed cycling. At 22:58 UTC the funnel was flowing end-to-end again: MLB
`provider_offer_history` advancing (2,000+ rows/10min), 446 candidates/30min with
**390 qualified**, **51 picks created/30min**. This confirms the recovery path the
watchdog now automates.

## Post-deploy proof (pending merge + deploy)

After merge + deploy, assert: exactly one ingestor container; the cycle loop advances;
a simulated/observed transient DB failure does not kill the loop; the healthcheck
reflects loop progress (not pgrep-only); MLB offer-ingest resumes after a
failure/timeout; fresh MLB `provider_offer_history` (+ `provider_participant_id`)
rows persist and `provider_offer_current` advances; then rerun the live funnel and
stop at the next NO.

## Merge SHA

_Bound post-merge during lane close._
