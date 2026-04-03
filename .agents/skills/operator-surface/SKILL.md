---
name: operator-surface
description: Guard Unit Talk operator-web and command-center changes. Use when touching operator snapshots, pick detail/search views, command-center actions, or operational truth surfaces.
---

# Operator Surface

Use this when changing `apps/operator-web` or `apps/command-center`.

## Invariants

- operator-web is read-only
- command-center actions should use shared API helpers where possible
- operator views should reflect backend truth, not infer hidden state
- runtime health signals must match actual pipeline and worker semantics

## Verification

```bash
pnpm exec tsx --test apps/operator-web/src/server.test.ts apps/command-center/src/lib/server-api.test.ts
```

## Watch for

- accidental write surfaces in operator-web
- duplicated API base URL/header logic
- snapshot math that drifts from backend truth

## Reference

- [AGENTS.md](C:/Dev/Unit-Talk-v2-main/AGENTS.md)
