# Discord Message Contract Matrix — Unit Talk V2

> **Date:** 2026-03-24
> **Status:** Current-state truth. Updated after Run 001 audit.
> **Authority:** `docs/discord/pick_promotion_interim_policy.md`, `docs/audits/v2_score_promotion_truth_audit.md`

---

## Purpose

Define which pick types route to which Discord channels under V2 current-state runtime behavior. This is a routing truth document, not a design spec.

---

## Live Channel Targets

| Target | Channel ID | Status |
|--------|-----------|--------|
| `discord:canary` | `1296531122234327100` | Live — integration test / control lane |
| `discord:best-bets` | `1288613037539852329` | Live — model-qualified only |
| `discord:trader-insights` | `1356613995175481405` | Live — model-qualified, strictest gate |
| `discord:exclusive-insights` | `1288613114815840466` | Blocked — activation contract required |
| `discord:game-threads` | — | Blocked — thread routing not implemented |
| `discord:strategy-room` | — | Blocked — DM routing not implemented |

---

## Routing Matrix

| Pick Type | Lane | `discord:canary` | `discord:best-bets` | `discord:trader-insights` | Notes |
|-----------|------|:-:|:-:|:-:|-------|
| Model-qualified pick (score ≥ 80, edge ≥ 85, trust ≥ 85, conf ≥ 0.6) | Model-qualified | test only | NO — routes to TI | YES | TI wins priority; BB row not written |
| Model-qualified pick (score ≥ 70, conf ≥ 0.6) | Model-qualified | test only | YES | NO | Does not meet TI thresholds |
| Smart Form / manual pick (no confidence) | Manual/capper | test only | NO | NO | Currently hard-blocked at confidence floor gate — known interim gap |
| Operator override pick | Curated | — | YES (explicit) | YES (explicit) | Requires `force_promote` + reason string |
| Any pick (test run) | Any | YES | — | — | Canary is the integration test lane |
| Blocked target pick | — | — | BLOCKED | BLOCKED | `exclusive-insights`, `game-threads`, `strategy-room` not activated |

---

## Gate Summary per Channel

### `discord:best-bets`
1. `approvalStatus === 'approved'`
2. Required fields present (market, selection, source)
3. Not stale, within posting window, market valid, not risk-blocked
4. Board caps not exceeded (perSlate ≤ 5, perSport ≤ 3, perGame ≤ 1) — **open risk: counts historical picks, may be saturated**
5. `pick.confidence ≥ 0.6`
6. Promotion score ≥ 70
7. Not overridden to suppress
8. Not pre-empted by Trader Insights qualification

### `discord:trader-insights`
All Best Bets gates above, PLUS:
- Promotion score ≥ 80
- Edge score component ≥ 85
- Trust score component ≥ 85

### `discord:canary`
No promotion gate — all picks with `distribution_outbox` target `discord:canary` are delivered. Used for integration testing.

---

## Manual/Capper Lane — Current Behavior

Picks without a `confidence` field (all current Smart Form V1 submissions) bypass the confidence floor gate. The gate is only applied when confidence is explicitly present. This is source-agnostic — any pick lacking confidence bypasses the floor.

After bypassing the floor, these picks are scored (61.5 via static fallbacks) and suppressed at the score gate (61.5 < 70). `suppressed` means: evaluated, did not meet the model-qualified threshold. They are not dead on arrival.

**They do not auto-qualify for any channel.** Operator override is required to route a manual/capper pick to a live channel.

**Current behavior (implemented):** Smart Form picks without `confidence` bypass the confidence floor gate, are evaluated on their score (61.5), and land as `suppressed` (score gate: 61.5 < 70). They do not reach any Discord channel via the promotion pipeline. Operator override is the only way to route a Smart Form pick to a live channel.

---

## Confidence Language Rule

`pick.confidence` is a technical scoring input. It is not a user-facing signal. Do not display it in Discord embeds. Do not reference it in marketing copy.

---

## EV / Edge Display

EV/edge may only be shown when:
- `pick.confidence` is present and in (0, 1) range
- `pick.odds` is present and valid
- Domain analysis ran and computed `metadata.domainAnalysis.edge`

Smart Form picks currently never satisfy these preconditions. EV/edge must not be displayed for Smart Form picks.

See `docs/discord/discord_embed_system_spec.md` for full display policy.

---

## Authority References

| Document | Role |
|----------|------|
| `docs/discord/pick_promotion_interim_policy.md` | Interim promotion operating rules |
| `docs/audits/v2_score_promotion_truth_audit.md` | Scoring/promotion code truth |
| `packages/contracts/src/promotion.ts` | Policy constants, thresholds, board caps |
| `packages/domain/src/promotion.ts` | Gate evaluation logic |
| `apps/api/src/promotion-service.ts` | Dual-policy evaluation and routing |
| `CLAUDE.md` | Live channel IDs and blocked target list |
