---
name: promotion-routing
description: Guard Unit Talk promotion policy and routing behavior. Use when changing promotion scores, target selection, routing gates, edge/trust/readiness interpretation, or promotion history persistence.
---

# Promotion Routing

Use this for promotion policy or target-routing changes.

## Invariants

- promotion policy lives in domain/contracts, not ad hoc app code
- qualification and routing are separate from approval
- live routing must still enforce promotion target and status gates
- promotion history must reflect the actual policy decision path

## Verification

```bash
pnpm exec tsx --test apps/api/src/promotion-edge-integration.test.ts apps/api/src/submission-service.test.ts packages/domain/src/promotion-conviction.test.ts
```

## Reference

- [`.agents/skills/betting-domain/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/betting-domain/SKILL.md)
- [`.agents/skills/pick-lifecycle/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/pick-lifecycle/SKILL.md)
