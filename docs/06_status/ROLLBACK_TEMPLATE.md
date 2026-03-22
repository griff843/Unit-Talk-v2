# Rollback Template — T1 Sprints

> Reusable template for T1 (high-risk) sprint rollback planning.
> Fill this in before activating any high-risk change.

## Sprint

- **Name:** `SPRINT-<NAME>`
- **Tier:** T1
- **Date:** YYYY-MM-DD

## What Was Changed

| Component | Change | Reversible |
|-----------|--------|------------|
| <component> | <description> | YES/NO |

## Rollback Triggers

Rollback if any of the following occur within the monitoring window:

1. <trigger condition 1>
2. <trigger condition 2>
3. <trigger condition 3>

## Rollback Steps

### Code Rollback

```bash
git revert <commit hash>
# or
git reset --hard <pre-change commit>
```

### Schema Rollback (if migration applied)

```sql
-- Rollback SQL here
```

### Routing Rollback (if live routing changed)

```
<steps to restore previous routing state>
```

## Monitoring Window

- **Duration:** <hours/days>
- **What to watch:** <metrics, logs, health endpoints>
- **Who monitors:** <operator/automated>

## Post-Rollback Verification

```bash
pnpm verify
# Confirm test count matches pre-change baseline
```
