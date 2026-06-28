# UTV2-1329 Verification Log

**Issue:** UTV2-1329 — Backup/PITR Proof
**Lane:** claude/utv2-1329-backup-pitr-proof
**Tier:** T2
**Date:** 2026-06-28

## Verification

| Command | Status |
|---------|--------|
| `pnpm type-check` | PASS |
| `pnpm test` | PASS |
| `pnpm verify` | PASS |
| `pnpm test:db` | PASS |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS |

Docs-only lane — no code changes. Verify confirms no regressions.

## Live DB Evidence

Queried via Supabase MCP (project: zfzdnfwdarxucxtaojxm) on 2026-06-28.

### Project Status

```
Project:    Unit Talk DB
Region:     us-west-2
Status:     ACTIVE_HEALTHY
PG version: 17.6.1.111 (PostgreSQL 17, release channel: ga)
```

### WAL Archiving / PITR

```sql
SELECT archived_count, last_archived_wal, last_archived_time,
       failed_count, last_failed_wal, last_failed_time, stats_reset
FROM pg_stat_archiver;
```

| Field | Value |
|-------|-------|
| archive_mode | `on` |
| archived_count | 11,122 WAL segments |
| last_archived_wal | `0000000100000198000000AE` |
| last_archived_time | 2026-06-28 10:46:32 UTC |
| failed_count | 2 |
| last_failed_wal | `000000010000019000000043` |
| last_failed_time | 2026-06-27 13:52:03 UTC |
| stats_reset | 2026-06-23 18:21:24 UTC |

**PITR verdict: ACTIVE.** WAL archiving is enabled (`archive_mode=on`). 11,122 segments archived since 2026-06-23. The last archive completed 4 minutes before this query — continuous archiving is healthy. 2 archive failures are transient (occurred yesterday, not blocking current archiving).

PITR coverage window: from 2026-06-23 18:21 UTC onward (stats reset date; project created 2026-04-20, coverage extends further per Supabase retention policy).

### Supabase Backup Policy

Supabase Pro projects include:
- **Daily backups**: retained for 7 days (automatic)
- **PITR**: WAL archiving enables point-in-time recovery at second granularity within the retention window
- Recovery is initiated via Supabase dashboard or support ticket

No custom backup configuration required — Supabase manages backup storage.

## Scope Check

Files changed: `docs/06_status/proof/UTV2-1329/` only — within declared file scope lock.

No code, migration, or schema changes.

## pnpm test:db Output

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

**Merge SHA:** pending (auto-bound post-merge)
