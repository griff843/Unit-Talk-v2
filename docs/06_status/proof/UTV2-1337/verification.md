# UTV2-1337 Verification

## Verification

Run date: 2026-06-28
Branch: `codex/utv2-1337-rollback-proof`

Commands run:

- `pnpm ops:brief` — passed; branch `codex/utv2-1337-rollback-proof`, issue `UTV2-1337`, no PR yet.
- `pnpm type-check` — passed.
- `pnpm test` — first run failed in `scripts/codex-receive.test.ts` because the generated local branch `codex/utv2-99205-receive` already existed during the test. Immediate inspection after the run showed the branch was no longer present, indicating transient test residue.
- `pnpm test` rerun — passed.

Issue-specific verification:

- `git diff --name-status origin/main...HEAD` showed lane metadata additions before proof files were created:
  - `.ops/sync/UTV2-1337.yml`
  - `docs/06_status/lanes/UTV2-1337.json`
- The lane manifest `docs/06_status/lanes/UTV2-1337.json` lists both expected proof paths as `.md` files.
- `docs/05_operations/r1-r5-rules.json` was checked. No R-level rule paths are triggered by this proof/governance-only branch.

### pnpm verify result

Run date: 2026-06-28
Command: `pnpm verify` (= `pnpm verify:static && pnpm test:live-db`)

```
ops:sync-check               PASS — branch matches .ops/sync/UTV2-1337.yml
ops:system-alignment-check   PASS — fail=0 warn=0
ops:automation-coverage-check PASS — fail=0 warn=0 classified=15
env:check                    PASS
lint                         PASS
type-check                   PASS
build                        PASS
test (unit suite)            PASS — all 113 tests, 13 suites, pass 113, fail 0
verify:commands              PASS — 14 command definitions verified, migrations clean
test:db (live DB smoke)      FAIL — pre-existing statement_timeout in listRecent settlements
                                     (not caused by this lane; docs-only branch changes no runtime code)
```

`pnpm verify:static` — PASS (all static gates green).
`pnpm test:db` — FAIL due to a live Supabase statement_timeout on `DatabaseSettlementRepository.listRecent`; this is a pre-existing infrastructure flake, not introduced by this lane. This lane touches only `docs/06_status/proof/UTV2-1337/` files and produces no runtime, DB, or domain changes.

### r-level-check result

Command: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

---

## Rollback Proof

### Deploy mechanism

Production deploys run via `.github/workflows/deploy.yml` (triggered by `workflow_dispatch`). The workflow builds Docker images for four services (api, worker, ingestor, discord-bot), pushes them to GHCR, then SSHes into the Hetzner production host and runs `docker compose up -d` with the new image tag. A canary phase deploys the API service first and health-checks it at `http://localhost:4000/health` before promoting all containers to production.

### Rollback command

App-layer rollback (container image rollback to a prior tag):

```bash
bash deploy/rollback.sh \
  --tag <previous-image-tag> \
  --host "$UNIT_TALK_DEPLOY_HOST" \
  --user "$UNIT_TALK_DEPLOY_USER" \
  --path "$UNIT_TALK_DEPLOY_PATH"
```

The script (`deploy/rollback.sh`) writes the previous tag to `.unit-talk-release`, then runs `docker compose pull && docker compose up -d --remove-orphans` on the production host. The automated rollback path is also triggered within the `canary` and `promote` workflow jobs if the health check loop fails and `rollback_tag` was provided as a workflow input.

Database-layer rollback follows `docs/05_operations/DB_ROLLBACK_RUNBOOK.md`. Supabase does not support declarative migration rollback via CLI. The two recovery paths are:
- **Forward-fix:** a new migration file that reverses the change (preferred; requires operator review)
- **PITR:** Point-in-Time Recovery via the Supabase Dashboard (required only for data-loss events; requires PM sign-off)

Dry-run validation is available and runs automatically in CI before every deploy:

```bash
bash deploy/rollback.sh --dry-run --tag <image-tag>
```

### Blast radius

- All four production services (api, worker, ingestor, discord-bot) restart during a full rollback; the canary path restarts only the API service.
- Expected service interruption: approximately 1–5 minutes while containers pull and start.
- Pick delivery pauses during the restart window; the outbox is durable and the worker will drain pending deliveries on the next cycle after restart.
- No data loss occurs from a container-image rollback; application state is in Supabase, not in the containers.
- A DB PITR rollback discards all database changes since the chosen restore point — this is the only path with data-loss risk, and it requires explicit PM sign-off per the runbook.

### Verification signal

After rollback execution, confirm success via:

1. `curl -fsS http://localhost:4000/health` returns HTTP 200 (same check the deploy workflow uses)
2. `docker compose ps` on the production host shows all four services as `running` with the previous image tag
3. Ingestor logs show a fresh cycle beginning within the next poll interval (peak: 30s, off-peak: 5min)
4. Outbox worker logs show it draining any pending delivery entries

A clean rollback is confirmed when the health endpoint returns 200 and `docker compose ps` shows the prior image tag across all services.

### Constraint

No live rollback was executed. This is a documentation proof lane only. Execution of a rollback requires a separate PM gate and operator action per the runbook and deploy workflow policies.
