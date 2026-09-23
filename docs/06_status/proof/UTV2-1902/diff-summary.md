# PROOF: UTV2-1902 Diff Summary

MERGE_SHA: pending merge

Generated at: 2026-09-23T06:00:00.000Z
Issue: UTV2-1902
Tier: T1
Lane type: runtime
Branch: claude/utv2-1902-score-gate-smart-form-best-bets
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1630
Head SHA: 6c53071c411ba5365c0ae014e6a793081091a29f
Execution SHA: 6c53071c411ba5365c0ae014e6a793081091a29f
Diff base: 4ab51ce8638062651fd3c8c572b260f5875dc6c0
result: pass

## Git Diff Stat

```
 .ops/sync/UTV2-1902.yml                            | 117 +++++++
 .../controllers/override-promotion-controller.ts   |  16 +
 apps/api/src/promotion-edge-integration.test.ts    | 225 ++++++++++++--
 apps/api/src/promotion-service.ts                  | 340 +--------------------
 apps/api/src/submission-service.test.ts            |  32 +-
 ...1-proof-utv2-1923-human-capper-delivery.test.ts |  21 ++
 apps/command-center/src/app/picks/[id]/page.tsx    |  69 +++--
 apps/command-center/src/lib/data/queues.ts         |   3 +
 .../src/lib/promotion-presentation.test.ts         | 110 +++++++
 .../src/lib/promotion-presentation.ts              | 103 +++++++
 docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md    |  27 ++
 docs/06_status/lanes/UTV2-1902.json                |  45 +++
 docs/06_status/proof/UTV2-1902/.gitkeep            |   0
 13 files changed, 715 insertions(+), 393 deletions(-)
```

## What changed, and why

PM rule, ratified under UTV2-1900: **intake source never confers promotion.**

1. `apps/api/src/promotion-service.ts` removes `buildSmartFormQualifiedResult` and the
   `source === 'smart-form'` early return. That path forced every Smart Form pick to
   `qualified` on `best-bets` through a `force_promote`, whatever its score. Board promotion
   is now earned against the promotion policy threshold, like any other source. The
   confidence-floor and exposure-gate Smart Form carve-outs are unchanged.
2. A human capper delivery pick (`isHumanCapperDeliveryAuthorized`) is still scored, for
   information, and is suppressed with the explicit reason
   `HUMAN_CAPPER_BOARD_PROMOTION_NOT_APPLICABLE`. It reaches `official-picks` through its
   authorization record, which this diff neither widens nor narrows.
3. `apps/api/src/controllers/override-promotion-controller.ts` refuses `force_promote` for a
   human capper delivery pick with `409 HUMAN_CAPPER_DELIVERY_PICK`. `suppress` stays allowed.
4. Command Center pick detail (`promotion-presentation.ts`, `page.tsx`, `queues.ts`) keeps
   three facts apart: the board target or its explicit absence; whether status was earned by
   score or imposed by an override; and an explicit `hasRealEdge: false`.
5. `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` §7a writes the rule into the canonical
   contract.

Test files: new UTV2-1902 cases in `promotion-edge-integration.test.ts`,
`submission-service.test.ts` and `t1-proof-utv2-1923-human-capper-delivery.test.ts`, plus the
new `promotion-presentation.test.ts`. Existing fixtures that silently relied on the
source-only path were changed to fixtures that honestly meet the threshold.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1630
