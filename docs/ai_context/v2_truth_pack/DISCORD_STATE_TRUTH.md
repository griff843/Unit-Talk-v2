# Unit Talk V2 — Discord State Truth

> Generated: 2026-03-24. Grounded in `CLAUDE.md`, `docs/05_operations/discord_routing.md`, `PROGRAM_STATUS.md`, and `system_snapshot.md`.

---

## Live Routing State

| Target | Channel ID | Status | Notes |
|--------|-----------|--------|-------|
| `discord:canary` | `1296531122234327100` | **LIVE** | Permanent control lane. Never removed. Not a VIP+ channel — integration test lane only. |
| `discord:best-bets` | `1288613037539852329` | **LIVE** | Production channel. Real picks. Gated by promotion engine. |
| `discord:trader-insights` | `1356613995175481405` | **LIVE** | Production channel. Real picks. Stricter gate (score≥80, edge≥85, trust≥85). |
| `discord:exclusive-insights` | `1288613114815840466` | **BLOCKED** | Not implemented. |
| `discord:game-threads` | — | **BLOCKED** | Thread routing not implemented in V2 worker (worker posts to channel IDs only). |
| `discord:strategy-room` | — | **BLOCKED** | DM routing not implemented. |

**Guild ID:** `1284478946171293736`

---

## Channel Activation Rules

**Do not activate blocked targets without:**
1. A written and ratified contract in `docs/05_operations/`
2. A canary preview run through `discord:canary` first
3. Graduation criteria satisfied (see `docs/05_operations/trader_insights_graduation_criteria.md` as reference)
4. Explicit operator approval
5. `PROGRAM_STATUS.md` routing table updated

This is a **T1 sprint trigger** — any live routing change requires the full T1 governance process (contract + proof bundle + independent verification + rollback plan).

---

## Delivery Architecture

**Worker posts to channel IDs only.** The worker's `DeliveryAdapter` calls a single function:

```typescript
sendEmbed(channelId: string, embed: DiscordEmbed): Promise<{ messageId: string }>
```

**Architectural gaps:**
- `discord:game-threads` — legacy used `sendEmbedToThread(threadId)`. V2 has no thread routing.
- `discord:strategy-room` — legacy sent personal DM + public ack. V2 has no DM mechanism.

---

## Routing Gate (distribution-service.ts)

Before any pick reaches Discord, `distribution-service.ts` enforces:

```
pick.promotion_status must be 'qualified'
pick.promotion_target must equal the outbox target
```

A pick that is `suppressed`, `not_eligible`, or `eligible` never reaches any Discord channel.

---

## Embed Specs

**Best Bets embed:**
- Color: `0xff9900` (orange)
- Title: `Unit Talk Best Bet`
- Fields: market, selection, odds, stakeUnits, edge/EV (only if real inputs exist — see EV/Edge display rule below)

**Trader Insights embed:**
- Color: `0x4f8cff` (blue)
- Title: `Unit Talk V2 Trader Insight`
- Footer: `Target: discord:trader-insights | ...`

**Canary embed:**
- Used for preview/testing only
- No product content requirements

**EV/Edge Display Rule (from `docs/discord/discord_embed_system_spec.md` and `docs/discord/pick_promotion_interim_policy.md`):**

EV/edge MAY ONLY be displayed when:
1. `pick.confidence` is present and in (0, 1) range
2. `pick.odds` is present and valid
3. Domain analysis ran and computed both `edge` and `kellyFraction` from those inputs

If either `confidence` or `odds` is absent, EV/edge was not computed — **hide it entirely**.

Smart Form V1 picks currently never qualify for EV/edge display.

---

## Pick Lanes for Discord Routing

### 1. Manual/Capper Lane
- Includes all Smart Form V1 picks (no `confidence` field)
- Scores 61.5 via static fallbacks
- Suppressed at score gate (61.5 < 70)
- Does NOT reach `discord:best-bets` or `discord:trader-insights`
- Eligible for VIP picks channel (not yet built) or operator override

### 2. Model-Qualified Lane
- `pick.confidence` present in (0,1) AND `pick.odds` present and valid
- Domain analysis computed edge and kellyFraction
- Score ≥ 70 (best-bets) or ≥ 80 with edge ≥ 85 and trust ≥ 85 (trader-insights)
- `pick.confidence ≥ 0.6`
- Board caps not exceeded
- Eligible for automatic Discord promotion

### 3. Operator Override Lane
- Operator calls `applyPromotionOverride()` with `action: 'force_promote'` + non-empty `reason`
- Bypasses all gates
- Visible in audit log with `override_action = 'force_promote'`
- Can reach any surface including Best Bets
- Must be rare

---

## Live Evidence (from system_snapshot.md)

Most recent confirmed live posts:

| Target | Discord Message ID | Receipt | Outbox |
|--------|--------------------|---------|--------|
| canary | `1484772686579241187` | `aafc482d` | `61d4b4a3` |
| best-bets | `1484638587143327895` | `4efafbb4` | `4d9db6ed` |
| trader-insights | `1484773505709904043` | `d0a5b55a` | `970e688d` |

All targets currently: 0 failed rows, 0 dead_letter rows.

---

## Channel Health Monitoring

The operator dashboard (`GET /api/operator/snapshot`) exposes:

```typescript
{
  bestBets: ChannelHealthSummary,
  traderInsights: ChannelHealthSummary,
  canary: { graduationReady, recentSentCount, ... }
}

ChannelHealthSummary {
  target: string
  recentSentCount: number
  recentFailureCount: number
  recentDeadLetterCount: number
  latestSentAt: string | null
  latestReceiptRecordedAt: string | null
  latestMessageId: string | null
  activationHealthy: boolean    // true = sent > 0 && failures == 0 && dead_letter == 0
  blockers: string[]
}
```

**Current values (as of 2026-03-24):**
- bestBets: `activationHealthy: true`, `recentSentCount: 3`, `latestMessageId: 1484638587143327895`
- traderInsights: `activationHealthy: true`, `recentSentCount: 2`, `latestMessageId: 1484773505709904043`
- canary: `graduationReady: true`, `recentSentCount: 3`
