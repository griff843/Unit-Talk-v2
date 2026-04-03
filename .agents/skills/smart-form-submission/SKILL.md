---
name: smart-form-submission
description: Guard Unit Talk smart-form and submission pipeline changes. Use when touching smart-form intake, browse/manual fallback, submission payloads, capper attribution, or smart-form promotion routing.
---

# Smart Form Submission

Use this when changing `apps/smart-form`, submission wiring, or smart-form-specific promotion behavior.

## Invariants

- smart-form source and `submittedBy` must survive through submission persistence
- manual fallback UX must still respect required matchup/event constraints
- submission changes must be verified through API tests, not just UI assumptions
- smart-form-specific promotion/routing behavior must remain explicit in tests

## Verification

```bash
pnpm exec tsx --test apps/api/src/submission-service.test.ts
```

If UI behavior changed, also run the focused smart-form e2e/spec path when feasible.

## Reference

- [`.agents/skills/betting-domain/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/betting-domain/SKILL.md)
