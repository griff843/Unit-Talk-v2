# Rollback Template — UTV2-124 Discord Circuit Breaker

> Use this template if circuit breaker causes instability after merge.
> Contract: `docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md`

---

## Rollback Triggers

Execute rollback if ANY of the following are observed:

- [ ] Worker logs show circuit opening on healthy targets (false positive threshold)
- [ ] Operator snapshot `workerRuntime` stuck in `degraded` despite worker delivering successfully
- [ ] `system_runs` rows for `worker.circuit-open` accumulate without being resolved
- [ ] Outbox rows for live targets stuck in `pending` unexpectedly (circuit blocking valid delivery)
- [ ] Test count drops below pre-merge baseline on re-run
- [ ] Worker fails to start due to circuit breaker initialization error

---

## Rollback Steps

### Option A — Env var disable (fast, no deploy)

Set `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD=99999` in the runtime env and restart the worker. This effectively disables the circuit (would require 99999 consecutive failures to open). No code change required.

### Option B — Code revert (clean, preferred if Option A doesn't resolve)

```bash
# Identify the merge commit for UTV2-124
git log --oneline | grep UTV2-124

# Revert
git revert <merge-commit-hash> --no-edit
git push origin main
```

After revert:
1. Confirm `pnpm verify` passes
2. Confirm `workerRuntime.health` returns to expected state in operator snapshot
3. Resolve any `system_runs` rows left in `running` state from `worker.circuit-open` events manually or via DB update

### Option C — Hotfix (if specific behavior is wrong, not structural)

If only the threshold/cooldown defaults are wrong, update env vars without a code deploy:
- `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD` — increase to reduce false opens
- `UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` — decrease to resume faster

---

## Post-Rollback Checks

- [ ] Worker is polling and delivering to live targets (check operator snapshot)
- [ ] No `worker.circuit-open` system_runs rows in `running` state
- [ ] `pnpm verify` exits 0
- [ ] Record rollback reason in `docs/06_status/` as `UTV2-124_rollback_record.md`

---

## Schema Rollback

NOT REQUIRED — UTV2-124 has no DB migrations.
