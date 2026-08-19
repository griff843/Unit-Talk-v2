# /operator-runbook

Zero-context operator runbook for the four failure-sensitive operations that must remain executable without tribal knowledge.

**Usage:**
- `/operator-runbook health-check`
- `/operator-runbook rollback`
- `/operator-runbook replay`
- `/operator-runbook restore-verify`

**Rule:** run the preflight block first. Do not skip failed checks.

---

## Universal preflight

Run from the repo root: `cd "$(git rev-parse --show-toplevel)"` (normally `/home/griff843/code/Unit-Talk-v2`).

### Required env vars

`@unit-talk/config` loads env for Node processes from the first file that exists, in order: `local.env`, then `.env`. Shell-level tools invoked below (`gh`, `psql`, `pg_restore`) do **not** go through that loader, so export the same file into the environment first — `set -a` is required, because a bare `source` only creates shell variables and child processes never see them:

```bash
ENV_FILE=""
for candidate in local.env .env; do
  [ -f "$candidate" ] && { ENV_FILE="$candidate"; break; }
done
[ -n "$ENV_FILE" ] || { echo "local.env or .env is required." >&2; exit 1; }
set -a; . "./$ENV_FILE"; set +a
```

Then confirm the values the operations below actually depend on:

```bash
[ -n "${LINEAR_API_TOKEN:-}" ] || [ -n "${LINEAR_API_KEY:-}" ] || { echo "LINEAR_API_TOKEN or LINEAR_API_KEY is required for operator queue and lane checks." >&2; exit 1; }
[ -n "${GITHUB_TOKEN:-}" ] || { echo "GITHUB_TOKEN is required for PR and merge-state checks." >&2; exit 1; }
{ [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; } || { echo "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for runtime and DB-backed operator commands." >&2; exit 1; }
```

### Required tools / CLIs

```bash
for tool in git node pnpm npx gh psql pg_restore gzip; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required for /operator-runbook." >&2; exit 1; }
done
```

### Repository sanity

```bash
git status --short --branch
pnpm ops:health -- --json
pnpm ops:brief
```

If `git status --short --branch` shows unrelated changes, record them before continuing. If `pnpm ops:health -- --json` exits non-zero, treat the repo as degraded until the blocker is understood.

---

## health-check

### What it does

Produces a current operational snapshot: repo health, active lanes, GitHub PR state, and pipeline/runtime status.

### Required env vars

- `LINEAR_API_TOKEN` or `LINEAR_API_KEY`
- `GITHUB_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Exact commands to run

```bash
pnpm ops:health
pnpm ops:brief
pnpm linear:work
pnpm github:current
pnpm pipeline:health
```

### Expected output

- `pnpm ops:health` ends with `VERDICT: HEALTHY` or `VERDICT: DEGRADED`
- `pnpm ops:brief` prints `Recommendation`, `Overview`, `Linear`, `GitHub`, and `Pipeline`
- `pnpm github:current` identifies the PR for the current branch or reports `(no pull request for current branch)`
- `pnpm pipeline:health` prints current queue counts such as `pending`, `processing`, `sent`, `failed`, or `dead_letter`

### What failure looks like

- Missing env: `LINEAR_API_TOKEN or LINEAR_API_KEY is required`, `GITHUB_TOKEN is required`, or `SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set`
- Missing tool: `pnpm is required for /operator-runbook.`
- Operational blocker: `VERDICT: BLOCKED`
- Runtime degradation: `CRITICAL`, `WARN`, `DOWN`, or repeated `dead_letter` rows in pipeline output

---

## rollback

### What it does

Validates that a target database still has the minimum required tables, row counts, and optional foreign-key integrity before or after a rollback decision. This command validates only; it does not execute the rollback.

### Required env vars

- `SUPABASE_DB_URL`
- Optional override: `ALLOW_PROD_ROLLBACK_VALIDATE=1` only if you intentionally validate production

### Exact commands to run

Dry run first:

```bash
npx tsx scripts/backup/rollback-validate.ts --tables submissions,picks,pick_lifecycle,distribution_outbox,audit_log --min-rows submissions:1,picks:1 --dry-run
```

Live validation with foreign-key checks:

```bash
npx tsx scripts/backup/rollback-validate.ts --tables submissions,picks,pick_lifecycle,distribution_outbox,audit_log --min-rows submissions:1,picks:1 --check-fk
```

### Expected output

- JSON with `"service": "backup-rollback-validate"`
- `"passed": true`
- `"failed": false`
- `"errors": []`

### What failure looks like

- Missing env: connection errors from `SUPABASE_DB_URL`
- Production guard: `Refusing rollback validation against production Supabase project zfzdnfwdarxucxtaojxm. Set ALLOW_PROD_ROLLBACK_VALIDATE=1 to override.`
- Data integrity failure: `Row-count check failed for ...` or `Orphaned FK references found for ...`

---

## replay

### What it does

Replays a previously captured provider-offer pack or runs the slate replay harness so an operator can reproduce an ingest or scoring path without relying on original operator memory.

### Required env vars

- For slate replay: repo defaults only
- For provider-offer capture/replay against live sources: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Optional live source auth: `SGO_API_KEY` or `SGO_API_KEYS`

### Exact commands to run

Capture a provider-offer replay pack:

```bash
npx tsx scripts/utv2-796-slate-replay.ts --engine provider-offer --action capture --provider sgo --league NBA --capture-root out/provider-offer-replay
```

Replay that pack safely in memory:

```bash
npx tsx scripts/utv2-796-slate-replay.ts --engine provider-offer --action replay --pack-dir out/provider-offer-replay/<pack-name> --persistence in-memory
```

Run slate replay harness:

```bash
npx tsx scripts/utv2-796-slate-replay.ts --engine slate --action run --volume 1x
```

### Expected output

- Provider-offer capture prints JSON with `"engine": "provider-offer"` and `"action": "capture"`
- Provider-offer replay prints JSON with `"action": "replay"`, `reportPath`, and `replaySummary`
- Slate replay prints JSON with `"engine": "slate"` and a `summary` block

### What failure looks like

- Missing pack input: `--pack-dir is required for provider-offer replay`
- Unsafe live write attempt: `provider-offer replay defaults to in-memory persistence; pass --allow-db-writes with --persistence database only for an intentional live DB write.`
- Missing billing acknowledgement for live DB replay: `provider-offer database replay requires --confirm-billing-checklist ...`
- Empty or invalid source data: replay JSON contains errors or the process exits non-zero

---

## restore-verify

### What it does

Restores a dump into a non-production target and proves the restored database contains the required tables and row counts.

### Required env vars

- `BACKUP_RESTORE_VERIFY_DUMP`
- `BACKUP_RESTORE_VERIFY_DATABASE_URL` or `RESTORE_VERIFY_DATABASE_URL`
- `BACKUP_RESTORE_VERIFY_TARGET_ENV`
- Optional: `BACKUP_RESTORE_VERIFY_SCHEMA`
- Optional: `BACKUP_RESTORE_VERIFY_TABLES`

### Exact commands to run

Dry run first:

```bash
npx tsx scripts/backup/restore-verify.ts --dry-run --dump-file <path-to-dump> --target-url <non-prod-database-url> --target-environment staging
```

Run the actual restore verification:

```bash
npx tsx scripts/backup/restore-verify.ts --dump-file <path-to-dump> --target-url <non-prod-database-url> --target-environment staging --expected-table picks --expected-table audit_log --expected-table distribution_outbox --expected-table settlement_records --expected-table pick_lifecycle
```

### Expected output

- JSON with `"service": "backup-restore-verify"`
- `"status": "pass"`
- `"productionGuard": "passed"`
- `"restore": { "attempted": true, ... }`
- `checks.schema.missingTables` is empty
- `checks.rowCounts` contains non-negative counts for each expected table

### What failure looks like

- Missing input: `Missing required restore verification input: ...`
- Production guard: `Refusing restore verification against production environment ...` or `Refusing restore verification against production Supabase project zfzdnfwdarxucxtaojxm`
- Missing dump: `Dump file not found: ...`
- Restore failure: `Restore command failed: ...`
- Schema failure: `Schema sanity check missing tables: ...`
- Count failure: `Row-count check failed for ...`

---

## Completion rule

When an operation fails, capture the exact command, exit code, and first failing line. Do not replace command output with a narrative summary.
