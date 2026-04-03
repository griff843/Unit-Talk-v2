---
name: supabase-migration
description: Handle Unit Talk database migrations safely. Use when adding or changing Supabase schema, regenerating database types, or validating DB-layer changes after a migration.
---

# Supabase Migration

Use this for schema changes and DB follow-up work.

## Required sequence

1. write or inspect migration under `supabase/migrations/`
2. regenerate types:
```bash
pnpm supabase:types
```
3. run verification:
```bash
pnpm type-check
pnpm test
pnpm test:db
```

## Rules

- never hand-edit [database.types.ts](C:/Dev/Unit-Talk-v2-main/packages/db/src/database.types.ts)
- keep migrations narrowly scoped
- if a migration affects repositories or contracts, update tests in the same lane

## Reference

- [AGENTS.md](C:/Dev/Unit-Talk-v2-main/AGENTS.md)
- [`.agents/skills/db-verify/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/db-verify/SKILL.md)
