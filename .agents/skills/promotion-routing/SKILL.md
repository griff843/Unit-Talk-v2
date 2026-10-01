---
name: promotion-routing
description: Guard promotion qualification and target-selection policy. Use for score interpretation, promotion gates/history, or promotion_target decisions; not worker delivery execution.
category: implementation
owner: codex
trigger: Changing promotion qualification, component interpretation, promotion_target selection, or promotion-history persistence.
---

# Promotion Routing

Use this for promotion policy or target-routing changes.
Use `runtime-delivery` instead for enqueue-to-receipt behavior that leaves the
promotion decision unchanged.

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
