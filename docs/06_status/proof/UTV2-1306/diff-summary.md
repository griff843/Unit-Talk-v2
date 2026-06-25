# Diff Summary — UTV2-1306

**Branch:** griffadavi/utv2-1306-g-const-11-retention-execution-preflight-schema-verified
**Tier:** T2 | **Lane type:** governance | **Executor:** claude
**Merge SHA:** ca71685d29a66c8640f211e85ab338a27e3d5540

## Changes

This lane contains governance artifacts only. No source code, migrations, or runtime files were modified.

### Files created
- `docs/06_status/proof/UTV2-1306/preflight-matrix.md` — Retention execution preflight matrix
- `docs/06_status/proof/UTV2-1306/diff-summary.md` — this file
- `docs/06_status/proof/UTV2-1306/verification.md` — verification log

### Files modified
- `docs/06_status/lanes/UTV2-1306.json` — lane manifest (created by lane-start)
- `.ops/sync/UTV2-1306.yml` — sync metadata (created by lane-start)

## Outcome

Produced a schema-verified execution decision matrix for the 5 hot tables (system_runs, raw_payloads, odds_snapshots, provider_offer_history, game_results). Key findings:

1. **raw_payloads and odds_snapshots are immutable** — BEFORE triggers block DELETE and UPDATE. Any retention execution on these tables requires a separate PM-gated Migration lane to disable triggers first.
2. **provider_offer_history requires snapshot_at in WHERE** — 60 partitions; without partition pruning, queries trigger statement_timeout (known incident vector).
3. **system_runs and game_results allow DELETE** — but require PM-approved WHERE clauses, row count pre-scan, and backup export before any execution.
4. **FK dependency ordering** — odds_snapshots must be archived before raw_payloads; provider_offer_history partitions before system_runs.

No execution authorized by this preflight. Four follow-up lanes defined (UTV2-NEXT-A through D).

## Guardrails confirmed
- No DELETE, UPDATE, DDL, or data mutation performed
- No backfill
- No production deploy
- No certification or economic claims
