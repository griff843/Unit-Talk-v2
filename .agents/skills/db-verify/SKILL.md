---
name: db-verify
description: Verify live Unit Talk DB truth after implementation. Use after DB-writing changes, during proof capture, or when runtime, operator, and persistence state may disagree.
---

# DB Verify

Use this after implementation that writes persistence state, or when debugging truth mismatches.

## Verification order

Prefer:
1. repo CLI / API route / direct live query
2. operator surface
3. runtime/API response
4. worker logs only as a last resort

Do not fix while checking. Report truth first.

## Typical commands

```bash
pnpm verify:pick -- <pick-id>
pnpm proof:t1 -- --pick <pick-id> --skip-verify
pnpm pipeline:health
```

Use focused DB or API checks based on the entity:
- submission
- promotion
- outbox/receipt
- lifecycle
- settlement
- audit

## Core rule

If two truth surfaces disagree, say exactly which table or API field contradicts which other field. Do not soften it.

## Reference

For the full shared team version, read:
- [`.claude/commands/db-verify.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/db-verify.md)
