# T2 Hedge Detection Contract

**Status:** RATIFIED 2026-03-28
**Issue:** UTV2-69
**Lane:** codex (implementation)
**Tier:** T2 — new DB table, new detection service, wired into alert agent scheduler
**Authority:** This document defines the V2 hedge detection implementation scope. Use the legacy `hedge-detector.ts` as a reference only — do not port behavior that conflicts with this contract.

---

## 1. Purpose

Detect cross-bookmaker opportunities from `provider_offers` where two books offer materially different lines on the same market, creating arbitrage, middle, or hedge coverage opportunities.

V2 improvement over legacy:
- Reads from `provider_offers` (not `raw_props` — the V2 canonical ingest table)
- No AI/OpenAI calls — deterministic math only
- DB-backed persistence with idempotency key
- Integrated into the existing alert-agent scheduler loop (not a separate Temporal workflow)
- Routes through the alert notification layer already built in UTV2-114

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Arbitrage** | Two books offer lines where the combined implied probability < 100%, guaranteeing profit regardless of outcome |
| **Middle** | Two books offer lines far enough apart that both sides can win simultaneously if the result falls in the gap |
| **Hedge** | Line discrepancy exists but does not meet arbitrage or middle thresholds — reduces variance on an existing position |
| **Implied probability** | The market-implied win probability derived from American odds |

---

## 3. Data Inputs

Reads from `provider_offers` only. Groups by `(provider_event_id, provider_market_key, provider_participant_id)` and compares offers from **different** `provider_key` values within a lookback window.

**Required columns:**
- `provider_event_id` — links to game
- `provider_participant_id` — player/team identifier
- `provider_market_key` — normalized market key
- `provider_key` — bookmaker identifier
- `line` — numeric line value
- `over_odds` / `under_odds` — American odds for each side
- `snapshot_at` — timestamp

**Lookback window:** 15 minutes (configurable via `HEDGE_LOOKBACK_MINUTES`).

---

## 4. Detection Algorithm

### 4.1 Matching

For each `(provider_event_id, provider_market_key, provider_participant_id)` group:
- Take the most recent snapshot per bookmaker (within lookback window)
- Require at least 2 distinct bookmakers to proceed
- Evaluate all bookmaker pairs

### 4.2 Implied Probability

American odds → implied probability:

```
if odds > 0:  impliedProb = 100 / (odds + 100)
if odds < 0:  impliedProb = |odds| / (|odds| + 100)
```

Use `over_odds` from bookmaker A and `under_odds` from bookmaker B (opposing sides).

### 4.3 Opportunity Classification

**Step 1 — Compute metrics:**
```
lineDiscrepancy = |lineA - lineB|
totalImpliedProb = impliedProbA + impliedProbB
arbitragePercentage = (1 - totalImpliedProb) × 100
```

**Step 2 — Classify:**

| Type | Condition |
|------|-----------|
| `arbitrage` | `arbitragePercentage >= 1.0%` |
| `middle` | `lineDiscrepancy >= 2.0` AND `arbitragePercentage < 1.0%` |
| `hedge` | `lineDiscrepancy >= 3.0` AND not arbitrage or middle |

If none of the above conditions are met, discard (no output).

### 4.4 Priority

| Priority | Arbitrage condition | Middle condition | Hedge condition |
|----------|--------------------|-----------------|----|
| `critical` | `profitPotential >= 5.0%` | `lineDiscrepancy >= 5.0` | — |
| `high` | `profitPotential >= 2.0%` | `lineDiscrepancy >= 4.0` | `lineDiscrepancy >= 5.0` |
| `medium` | `profitPotential >= 1.0%` | `lineDiscrepancy >= 3.0` | `lineDiscrepancy >= 4.0` |
| `low` | (below medium) | (below medium) | `lineDiscrepancy >= 3.0` |

### 4.5 Additional Computed Fields

**Guaranteed profit (arbitrage only):**
```
guaranteedProfit = (1 - totalImpliedProb) × 100  // percent of stake
```

**Middle win probability:**
```
baseProbability = min(0.8, lineDiscrepancy / 10)
avgImpliedProb = (impliedProbA + impliedProbB) / 2
winProbability = baseProbability × (1 - avgImpliedProb × 0.5)
```

---

## 5. Thresholds (code constants, initial implementation)

```typescript
const HEDGE_DETECTION_THRESHOLDS = {
  minArbitragePercentage: 1.0,   // % below 100 implied prob
  minMiddleGap: 2.0,             // points
  minHedgeDiscrepancy: 3.0,      // points
  lookbackMinutes: 15,           // configurable via HEDGE_LOOKBACK_MINUTES
};
```

---

## 6. Persistence Model

### 6.1 Table: `hedge_opportunities`

New table. Migration required before UTV2-69 can ship.

```sql
CREATE TABLE hedge_opportunities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key       TEXT NOT NULL UNIQUE,
  event_id              UUID REFERENCES events(id),
  participant_id        UUID REFERENCES participants(id),
  market_key            TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('arbitrage', 'middle', 'hedge')),
  priority              TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  bookmaker_a           TEXT NOT NULL,
  line_a                NUMERIC NOT NULL,
  over_odds_a           NUMERIC,
  bookmaker_b           TEXT NOT NULL,
  line_b                NUMERIC NOT NULL,
  under_odds_b          NUMERIC,
  line_discrepancy      NUMERIC NOT NULL,
  implied_prob_a        NUMERIC NOT NULL,
  implied_prob_b        NUMERIC NOT NULL,
  total_implied_prob    NUMERIC NOT NULL,
  arbitrage_percentage  NUMERIC NOT NULL,
  profit_potential      NUMERIC NOT NULL,
  guaranteed_profit     NUMERIC,           -- arbitrage only
  middle_gap            NUMERIC,           -- middle only
  win_probability       NUMERIC,           -- middle only
  notified              BOOLEAN NOT NULL DEFAULT false,
  notified_at           TIMESTAMPTZ,
  notified_channels     TEXT[],
  cooldown_expires_at   TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}',
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hedge_opportunities_event_market_idx
  ON hedge_opportunities (event_id, market_key, type, detected_at DESC);

CREATE INDEX hedge_opportunities_cooldown_idx
  ON hedge_opportunities (event_id, market_key, type, cooldown_expires_at)
  WHERE notified = true;
```

### 6.2 Idempotency Key

```
components = [event_id, participant_id || 'null', market_key, bookmaker_a, bookmaker_b, type, floor(detected_at / 5min_bucket)]
idempotency_key = sha256(components.join('|')).slice(0, 32)
```

### 6.3 Metadata JSONB

```json
{
  "sport": "NBA",
  "event_name": "Lakers vs Celtics",
  "participant_name": "LeBron James",
  "game_date": "2026-04-01"
}
```

---

## 7. Notification Routing

Use the same notification infrastructure built in UTV2-114 (`runAlertNotificationPass` pattern):

| Priority | Channels | Cooldown |
|----------|----------|----------|
| `low` | Never notified | — |
| `medium` | `discord:canary` | 30 min |
| `high` | `discord:canary` | 30 min |
| `critical` | `discord:canary` + `discord:trader-insights` | 15 min |

### 7.1 Embed Format

| Field | Content |
|-------|---------|
| Title | `🛡️ HEDGE OPP` / `💰 ARBITRAGE` / `🔁 MIDDLE — [MARKET]` |
| Description | `[BOOK_A] {lineA} vs [BOOK_B] {lineB} (gap: {discrepancy})` |
| Fields | Type, Priority, Arb %, Guaranteed Profit (if arb), Win Prob (if middle), books |
| Color | `0x3366ff` (blue) for hedge/middle; `0x00cc44` (green) for arbitrage |
| Footer | `detected_at · channel` |

---

## 8. Integration into Alert Agent

`runAlertDetectionPass` in `alert-agent-service.ts` currently handles line movement only. Hedge detection runs in the **same scheduler tick** but as a separate pass:

```
alert-agent.ts tick:
  1. runAlertDetectionPass()       → line movement signals
  2. runHedgeDetectionPass()       → hedge/arb/middle opportunities  (NEW)
  3. runAlertNotificationPass()    → notify line movement signals
  4. runHedgeNotificationPass()    → notify hedge opportunities       (NEW)
```

Both detection passes read from `provider_offers`. They are independent and can fail separately without affecting each other.

### 8.1 Kill Switch

```
HEDGE_AGENT_ENABLED=true|false   # Master kill switch (default: true)
HEDGE_DRY_RUN=true|false         # If true: persist but do not notify
HEDGE_LOOKBACK_MINUTES=15        # Evaluation window
```

---

## 9. Implementation Scope (UTV2-69 Codex)

- [ ] Migration: `hedge_opportunities` table + indexes
- [ ] `HedgeOpportunityRepository` interface + `InMemory` + `Database` implementations in `packages/db`
- [ ] `detectHedgeOpportunities(offers: ProviderOfferRecord[])` — pure function, returns `HedgeOpportunity[]`
- [ ] `classifyHedgeOpportunity(pair)` → type + priority + metrics
- [ ] `buildHedgeEmbed(opportunity, channelName)` → Discord embed
- [ ] `runHedgeDetectionPass(repositories, config)` — orchestration (read offers, detect, persist)
- [ ] `runHedgeNotificationPass(opportunities, repository, options)` — notification with cooldown
- [ ] Wire both passes into `alert-agent.ts` scheduler tick
- [ ] ≥ 8 net-new tests: arbitrage classification, middle classification, hedge classification, below-threshold discard, idempotency, cooldown suppression, embed format, dry-run isolation
- [ ] `pnpm verify` exits 0

---

## 10. Out of Scope

- Portfolio-level hedge optimization (RiskManagementAgent archived pattern — not ported)
- Parlay hedge math (not ported)
- Per-user hedge preference tracking
- Steam detection (separate future contract)
- Multi-book consensus beyond pair comparison

---

## 11. Authority and Update Rules

Update this contract if:
- Thresholds are tuned based on observed opportunity volume
- A new opportunity type is added (e.g., `teaser`)
- Routing targets change

Do not update to reflect implementation details.
