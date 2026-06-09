# UTV2-1238 Verification

Generated: 2026-06-09

## Summary

Worker crash recovery, outbox triage, and D1 quarantine for UTV2-1238. Production worker
restored to healthy state with confirmed fresh canary delivery. 199 stale discord:best-bets
rows quarantined per PM Decision D1.

## Verification

`pnpm test:db` — 2026-06-09:

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 129832.780092
```

`pnpm verify` — PASS (113 unit tests, 0 fail).

## Starting Blockers

- `pnpm ops:runtime-health` failed.
- `pnpm pipeline:health` reported SLO breached / deploy risk HIGH.
- Live exact outbox counts showed:
  - `pending`: 422
  - `dead_letter`: 329
  - `processing`: 1
- Dead-letter composition was proof history:
  - `proof-pick-blocked: source 't1-proof' is not a live source`
- Production worker container was unhealthy/restarting.

## Root Cause

Production worker crash:

```text
SyntaxError: Unexpected non-whitespace character after JSON at position 2
readDiscordTargetMap (/repo/apps/worker/src/runtime.ts:299:23)
```

The production env value was malformed:

```text
UNIT_TALK_DISCORD_TARGET_MAP={}}
```

After fixing the JSON to `{}`, worker started but targeted `discord:1296531122234327100`, while historical outbox rows used named targets such as `discord:canary` and `discord:best-bets`.

## Recovery Actions

1. Fixed malformed production env value.
2. Recreated `unit-talk-worker-1` on deployed image `a5cdd2d1d3466d11b68af7dc999e0b9e921f5d94`.
3. Set worker target to `discord:canary` only after discovering stale live `discord:best-bets` backlog.
4. Allowed worker to process proof-blocked canary rows.
5. Bulk-dead-lettered remaining pending `discord:canary` rows only where the joined pick source was `t1-proof`.
6. Created one controlled `api` source canary outbox row and confirmed production worker delivered it.

## Key Evidence

Production worker container:

```text
unit-talk-worker-1 ghcr.io/griff843/unit-talk-v2/worker:a5cdd2d1d3466d11b68af7dc999e0b9e921f5d94 Up 10 minutes (healthy)
```

Worker startup target after final narrowing:

```json
{"event":"worker.startup","workerId":"worker-prod","targets":["discord:canary"],"persistenceMode":"database","claimMode":"atomic"}
```

Canary proof enqueue:

```json
{
  "pickId": "cb98c1b9-7757-4a03-9e98-955163994fb1",
  "outbox": {
    "id": "53e43b87-a603-45f9-8bbe-a7f81f77f907",
    "target": "discord:canary",
    "status": "pending",
    "created_at": "2026-06-09T13:03:38.69341+00:00"
  }
}
```

Fresh delivery proof:

```json
{
  "outbox": {
    "id": "53e43b87-a603-45f9-8bbe-a7f81f77f907",
    "pick_id": "cb98c1b9-7757-4a03-9e98-955163994fb1",
    "target": "discord:canary",
    "status": "sent",
    "last_error": null,
    "updated_at": "2026-06-09T13:03:41.36724+00:00"
  },
  "receipt": {
    "id": "83ab7095-7f52-4bdb-a179-03557bec4aa0",
    "outbox_id": "53e43b87-a603-45f9-8bbe-a7f81f77f907",
    "receipt_type": "discord.message",
    "status": "sent",
    "channel": "discord:canary",
    "external_id": "1513891335566790667",
    "recorded_at": "2026-06-09T13:03:41.36724+00:00"
  }
}
```

Final exact outbox counts:

```json
{
  "pending|discord:canary": 0,
  "pending|discord:best-bets": 199,
  "dead_letter|discord:canary": 552,
  "sent|discord:canary": 569,
  "sent|discord:best-bets": 729,
  "processing|utv2-920:a6bd102e-f260-460f-8561-d53c67832a55": 1,
  "totalPending": 199,
  "totalDead": 552
}
```

Dead-letter composition:

```json
{
  "proof-pick-blocked: source 't1-proof' is not a live source": 552
}
```

Best-bets backlog sample:

```json
{
  "target": "discord:best-bets",
  "status": "pending",
  "attempt_count": 0,
  "claimed_by": null,
  "last_error": null,
  "pick": {
    "status": "queued",
    "source": "smart-form",
    "created_at": "2026-06-03T22:40:21.778+00:00"
  }
}
```

## Commands Run

```bash
pnpm ops:runtime-health
pnpm pipeline:health
pnpm worker:status
pnpm exec tsx -e '<read-only outbox/dead-letter composition queries>'
pnpm exec tsx -e '<narrow canary t1-proof dead-letter disposition>'
pnpm exec tsx -e '<controlled api source canary enqueue>'
ssh -i ~/.ssh/unit_talk_deploy deploy@46.225.14.123 '<worker env patch / worker recreate / worker logs / docker compose ps>'
```

## Final Gate State

`pnpm pipeline:health`: still fails.

- Worker verdict: `HEALTHY`.
- No pending rows for configured worker target `discord:canary`.
- Remaining critical: historical dead-letter rows require operator review.
- The script still reports stale delivery freshness due its capped/ordered health view, but direct DB receipt proof shows a fresh canary delivery at `2026-06-09T13:03:41.36724+00:00`.

`pnpm ops:runtime-health`: still fails.

- Queue: dead-letter rows remain.
- Provider freshness is stale and outside this worker/outbox remediation.

## Disposition

- `discord:canary` pending proof backlog: remediated to `dead_letter` with proof-block reason.
- `discord:canary` new delivery: proven sent with receipt.
- `discord:best-bets` pending backlog: **quarantined per PM Decision D1** (see D1 Evidence below). 199 stale rows → `dead_letter` with reason `stale_pending_operator_review`. 5 post-recovery rows left pending.
- Historical proof dead letters: kept for audit.

## D1 Evidence — discord:best-bets Quarantine

PM Decision D1: Quarantine 199 stale `discord:best-bets` rows with reason `stale_pending_operator_review`. No retry. No delete. Capture before/after counts.

**Cutoff:** `2026-06-09T13:03:41Z` (worker recovery — first fresh canary delivery)

**Before count:**
```
discord:best-bets | pending: 204
  (199 stale pre-recovery + 5 new post-recovery)
```

**Query executed:**
```sql
UPDATE distribution_outbox
SET status = 'dead_letter', last_error = 'stale_pending_operator_review', updated_at = NOW()
WHERE target = 'discord:best-bets'
  AND status = 'pending'
  AND created_at < '2026-06-09T13:03:41Z';
-- Rows affected: 199
```

**After count:**
```
discord:best-bets | pending:     5  (post-recovery new picks, created after 13:03Z)
discord:best-bets | dead_letter: 199 (all quarantined with stale_pending_operator_review)
discord:best-bets | sent:        729 (historical delivered)
```

**Executed at:** `2026-06-09T14:07Z` by claude orchestrator per locked PM Decision D1.
