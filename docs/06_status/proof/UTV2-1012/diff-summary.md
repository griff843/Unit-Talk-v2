# UTV2-1012 — Diff Summary

**Issue:** UTV2-1012 — Supervisor verification tooling  
**Tier:** T2  
**Branch:** `feat/utv2-1012-supervisor-verification`  

---

## What was built

### `scripts/ops/verify-supervisor.sh` (NEW)

A bash script that runs **on the production server** via SSH. It:

1. Calls `docker inspect` for each of the four unit-talk containers:
   - `unit-talk-api-1`
   - `unit-talk-worker-1`
   - `unit-talk-ingestor-1`
   - `unit-talk-discord-bot-1`
2. Captures per-container: `state`, `health`, `restartCount`, `image`, `startedAt`
3. Prints a human-readable table to stdout
4. Writes a JSON result file to `$DEPLOY_PATH/supervisor-status.json` via `python3 json.dumps` (guarantees valid JSON)
5. Exits `0` (PASS) or `1` (FAIL) based on verdict

**Verdict logic (fail-closed):**
- All 4 containers must be in `running` state
- `unit-talk-api-1` must report docker health as `healthy` (it has a configured healthcheck)
- No container may have `restartCount >= 10` (crash loop guard)

### `.github/workflows/ops-supervisor-status.yml` (NEW)

`workflow_dispatch`-only workflow that:

1. Validates presence of `UNIT_TALK_DEPLOY_HOST`, `UNIT_TALK_DEPLOY_USER`, `UNIT_TALK_DEPLOY_PATH`, `UNIT_TALK_DEPLOY_SSH_KEY` secrets
2. Installs the SSH key and scans host key
3. Uploads `verify-supervisor.sh` to `$DEPLOY_PATH/scripts/` on the server
4. Executes it via SSH, printing stdout into the GHA log
5. Downloads `supervisor-status.json` from the server
6. Checks the `verdict` field — fails the workflow job if `FAIL`
7. Uploads the JSON as artifact `supervisor-status-<run_id>` (retained 30 days)

---

## Acceptance criteria mapping

| Criterion | How it is met |
|---|---|
| `pnpm api:status` equivalent | `unit-talk-api-1` state=running + health=healthy checked by script |
| `pnpm worker:status` equivalent | `unit-talk-worker-1` state=running checked by script |
| `pnpm ingestor:status` equivalent | `unit-talk-ingestor-1` state=running checked by script |
| Supervisor UP | All 4 containers checked — discord-bot included |
| Health endpoint reachable | docker healthcheck status `healthy` confirms `/health` responded correctly |
| Machine-readable evidence | `supervisor-status.json` artifact attached to every workflow run |
| Fail-closed | Script exits 1 on any failure; workflow job fails; artifact still uploaded for diagnosis |

---

## Files changed

```
scripts/ops/verify-supervisor.sh                     NEW
.github/workflows/ops-supervisor-status.yml          NEW
docs/06_status/proof/UTV2-1012/diff-summary.md       NEW
docs/06_status/proof/UTV2-1012/verification.md       NEW
```

No existing files were modified.
