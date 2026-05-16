# Runtime Verification — UTV2-910

**Issue:** Ingestor cadence break — one-shot bridge leaves offer data stale
**Tier:** T1
**Branch:** griffadavi/utv2-910-ingestor-cadence-break-one-shot-bridge-leaves-offer-data
**Branch SHA:** f5049b8a (pre-merge; update to merge SHA after squash)

## pnpm test:db — Live Supabase

Run date: 2026-05-15
Supabase project: zfzdnfwdarxucxtaojxm

```
✔ database repository bundle persists a submission and settlement when Supabase is configured (43156ms)
✔ UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row (42328ms)
✔ UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes (45720ms)

exit code: 0
```

All 3 DB smoke tests passed against live Supabase.

## pnpm verify:quick — Static checks

```
ops:sync-check  PASS
env:check       PASS
lint            PASS
type-check      PASS
```

## Changes made

### `.github/workflows/ingestor-scheduled-run.yml`

1. **Added concurrency guard** — prevents overlapping ingestor runs when a cycle
   takes longer than the 5-minute cron interval:
   ```yaml
   concurrency:
     group: ingestor-scheduled-run
     cancel-in-progress: false
   ```
   `cancel-in-progress: false` ensures the running job is never killed; the next
   trigger queues and runs after the current one completes.

2. **Changed MAX_CYCLES from 8 → 2** — each GHA trigger runs exactly 2 bounded
   cycles then exits. GHA cron owns the outer loop; the ingestor no longer needs
   to do 8 cycles with 1-second gaps.

3. **Added POLL_MS=30000** — 30-second inter-cycle pause keeps the total job
   runtime under 5 minutes, well inside the 10-minute GHA timeout.

4. **Removed internal scheduler env vars** (`SCHEDULING_ENABLED`, `PEAK_POLL_MS`,
   `OFFPEAK_POLL_MS`) — adaptive peak/off-peak scheduling is superseded by the
   GHA cron cadence. Simpler and more predictable.

5. **Fixed stale comment** — header said "every 25 minutes" but cron is `*/5`.

## Why MAX_CYCLES=2 not 1

`assertProductionRuntimeConfig` rejects `MAX_CYCLES=1` with autorun=true via the
`prohibitSingleCycleAutorunInProduction` guard (intended to prevent accidental
single-cycle runs in persistent daemon mode). Two bounded cycles with a 30-second
gap satisfy the PM's "bounded, idempotent" requirement without modifying the guard.

## Acceptance criteria status

| AC | Status |
|---|---|
| GHA scheduled ingestion every 5 minutes | ✓ already present (cron `*/5 * * * *`) |
| Manual dispatch available | ✓ `workflow_dispatch` already present |
| Concurrency prevents overlapping runs | ✓ added concurrency group |
| provider_cycle_status.updated_at advances | verified by existing cycle logic (no change) |
| Proof log: 3 consecutive fresh cycles | pending live GHA run after merge |
| stale_price_data no longer dominant rejection | pending post-merge monitoring |
