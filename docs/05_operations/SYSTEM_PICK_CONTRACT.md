# System Pick Contract

**Status:** RATIFIED  
**Date:** 2026-04-02  
**Linear:** UTV2-294  
**Tier:** T1 — Contract / Architecture

---

## Decision: System Picks Are Canonical Lifecycle Entities

A **system pick** is a `picks` row created programmatically (not by a human capper via the Smart Form or API submission). System picks participate in the full pick lifecycle: `validated → queued → posted → settled`. They are subject to all promotion, distribution, and audit rules.

This decision is intentional and ratified. There is no separate system-pick fast path, bypass, or lite lifecycle.

---

## Current State (as of 2026-04-02)

The `alert-agent` app is **notification-only**. It does NOT create `picks` rows.

- `apps/alert-agent/src/main.ts` — polls `provider_offers` for line movement and sends Discord webhooks
- It calls `alert-agent.ts` / `alert-agent-service.ts` in `apps/api/src/`, which query DB read-only and deliver via webhook
- No writes to `picks`, `submissions`, `distribution_outbox`, or any lifecycle table

This means there are currently **zero system picks** in the system. The `source: 'system'` and `source: 'alert-agent'` values in `PickSource` exist for future use only.

---

## PickSource Registry

System picks must use a typed source value from `PickSource` in `@unit-talk/contracts`:

```typescript
export const pickSources = [
  'smart-form',    // human capper via Smart Form UI
  'feed',          // automated feed ingestion (write-blocked pending contract)
  'system',        // system-generated (general)
  'alert-agent',   // alert agent pipeline (not yet wired)
  'model-driven',  // model/AI-generated pick
  'api',           // direct API submission (operator tooling)
] as const;

export type PickSource = (typeof pickSources)[number];
```

Adding a new source requires:
1. Adding to `pickSources` array in `packages/contracts/src/submission.ts`
2. Reviewing all source-based conditionals in `promotion-service.ts` and `settlement-service.ts`
3. Creating a contract for the new pipeline before wiring it

---

## Source-Based Conditionals (Current Runtime Enforcement)

| Source | Location | Rule |
|--------|----------|------|
| `'smart-form'` | `promotion-service.ts:162,439` | Confidence floor bypassed — Smart Form picks are deliberate human submissions |
| `'feed'` | `settlement-service.ts:68` | Automated settlement blocked — feed-triggered settlement requires separate ratified contract |

These are the only source-based conditionals in the system. Any new source that requires different routing behavior **must** add a corresponding entry here and in the contract.

---

## GP-M2 Scope: Wiring Alert-Agent into Submission Pipeline

Future milestone GP-M2 will wire the alert-agent into the canonical submission pipeline to create system picks. This requires:

1. **Extract alert logic from `apps/api/src/`** to a shared package (resolves cross-app import violation documented in `apps/alert-agent/CLAUDE.md`)
2. **Define system pick payload shape** — what market, selection, line, odds, confidence values an alert-driven pick carries
3. **Implement `POST /api/submissions`** call from alert-agent with `source: 'alert-agent'`
4. **Define promotion policy for alert-agent source** — what score profile applies, whether confidence floor bypass applies
5. **Settlement policy** — can alert-agent picks be auto-settled from feed results?

GP-M2 is **deferred**. Do not wire alert-agent into the submission pipeline until a full GP-M2 contract exists and is ratified.

---

## What NOT to Do

- Do not create `picks` rows directly from `apps/alert-agent/` (cross-app write violation)
- Do not add a system-pick bypass that skips promotion evaluation
- Do not treat alert-agent Discord webhooks as pick posts — they are line movement notifications, not pick deliveries
- Do not activate `source: 'alert-agent'` submission path without GP-M2 contract

---

## Cross-References

- `packages/contracts/src/submission.ts` — `PickSource` registry
- `apps/alert-agent/CLAUDE.md` — alert-agent current capabilities + known cross-app import violation
- `docs/05_operations/T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT.md` — alert detection thresholds
- `docs/05_operations/T1_ALERT_COMMANDS_CONTRACT.md` — alert commands contract
