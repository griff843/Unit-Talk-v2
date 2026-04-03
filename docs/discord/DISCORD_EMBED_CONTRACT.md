# Discord Embed Contract

**Status:** RATIFIED  
**Authority:** Runtime (`apps/worker/src/delivery-adapters.ts`, `apps/api/src/recap-service.ts`)  
**Updated:** 2026-04-03

---

## 1. Scope

This contract covers the structure and content policy for two types of Discord embeds:

1. **Pick embeds** — posted by the worker when delivering an outbox row to a pick channel
2. **Recap embeds** — posted by the recap service to `discord:recaps`

It does NOT cover bot slash commands (`apps/discord-bot`).

---

## 2. Pick Embed Fields

Pick embeds are built in `buildDiscordMessagePayload()` in `delivery-adapters.ts`.

### Required fields (always present)

| Field | Source | Notes |
|-------|--------|-------|
| `Pick` (inline) | `payload.selection` + `payload.line` | Line formatted as ` @ +N` or ` @ −N` |
| `Odds` (inline) | `payload.odds` | Formatted as ` (+N)` or ` (−N)` |
| `Capper` (inline) | `metadata.capper` | Falls back to `'Unit Talk'` |
| `Posted` (inline) | `new Date()` | Local time with timezone short name |

### Conditional fields (present only when data exists)

| Field | Condition | Source |
|-------|-----------|--------|
| `Units` (inline) | `payload.stakeUnits != null` | Raw number, e.g. `1.5` |
| `Confidence` (inline) | `payload.confidence != null` | Displayed as `XX%` (0–1 scaled to %) |
| `Implied Prob` (inline) | `metadata.domainAnalysis.impliedProbability != null` | Displayed as `XX.X%` |
| `Capper record` (appended to Capper) | `metadata.capperRecord` | Appended as `(record)` |
| `CLV` (appended to Capper) | `metadata.capperClvPct != null` | Appended as `\| CLV: +X.X%` |
| Lead field (full width, first) | Target-specific | See Section 4 |

### Embed-level fields

| Property | Value |
|----------|-------|
| `title` | Target-specific (see Section 4) |
| `description` | `<sport> \| <eventName>` or target default |
| `color` | Target-specific (see Section 4) |
| `footer.text` | `'Unit Talk'` |
| `timestamp` | ISO timestamp of delivery moment |

---

## 3. What Is Never Shown in Pick Embeds

The following data is explicitly excluded from public Discord embeds:

| Data | Reason |
|------|--------|
| Promotion score components (`edge`, `trust`, `readiness`, `uniqueness`, `boardFit`) | Internal evaluation signal, not a public claim |
| `promotionScores` breakdown | Internal only |
| `realEdge` / `realEdgeSource` | Confidence delta ≠ market edge; must not be labeled as edge |
| Sportsbook name / book identifier | Not present in pick payload |
| Member tier (Bronze/Silver/Gold/etc.) | Member access tier is not a pick evaluation signal |
| `domainAnalysis` beyond `impliedProbability` | Internal enrichment |
| Pick ID / internal IDs | Not relevant to members |

**Explicit runtime comment:** "Does NOT show fake edge — confidence delta is not market edge (Sprint D)."

---

## 4. Target-Specific Presentation

### `discord:best-bets`

| Property | Value |
|----------|-------|
| `title` | `Unit Talk V2 Best Bet` |
| `color` | `0xffd700` (gold) |
| Lead field name | `Best Bets Purpose` |
| Lead field value | `This lane is for the most presentation-ready curated picks. It should feel like a premium showcase, not a raw canary dump.` |
| `content` | `undefined` |

### `discord:trader-insights`

| Property | Value |
|----------|-------|
| `title` | `Unit Talk V2 Trader Insight` |
| `color` | `0x4f8cff` (blue) |
| Lead field name | `Trader Insights Purpose` |
| Lead field value | `This lane is for sharper market-alerts signals: higher edge, higher trust, and cleaner timing than a general premium board.` |
| `content` | `undefined` |

### `discord:canary` and all other targets

| Property | Value |
|----------|-------|
| `title` | `Unit Talk V2 Canary` |
| `color` | `0xf5b041` (orange) |
| Lead field | none |
| `content` | `Canary delivery active. Validate formatting before expanding routing.` |

---

## 5. Recap Embed Fields

Recap embeds are built in `buildRecapEmbed()` in `recap-service.ts`.

### Required fields (always present)

| Field | Inline | Content |
|-------|--------|---------|
| `Record` | yes | `W-L-P` |
| `Net Units` | yes | `+X.XXu` with sign |
| `ROI` | yes | `+X.XX%` with sign |
| `Sample` | yes | `N picks over D days` (+ small-sample warning if < 20 picks) |
| `Top Play` | no (full width) | Selection (market), Result, P/L, Capper |

### Embed-level fields

| Property | Value |
|----------|-------|
| `title` | `<Period> Recap - <date range>` |
| `color` | `0x2f855a` (green) if `netUnits ≥ 0`; `0xc53030` (red) otherwise |

### Small sample warning

If `totalPicks < 20`, the `Sample` field value appends:  
`_Small sample — interpret with caution_`

---

## 6. What Is Never Shown in Recap Embeds

| Data | Reason |
|------|--------|
| Individual pick odds, confidence, edge | Not aggregated or surfaced per-pick in recaps |
| Pick IDs | Not relevant to members |
| Sportsbook names | Not present |
| Member tiers | Not relevant |
| CLV per pick | Not computed at recap time |

---

## 7. Tier Display Policy

**Member tiers (Bronze/Silver/Gold/etc.) are not shown in any public Discord embed.**

Rationale: Member tier governs access to channels, not pick quality. Pick evaluation signals (confidence, implied probability, promotion qualification) are separate from membership tier. These must never be conflated in embeds or documentation.

Pick-quality routing (best-bets vs trader-insights vs canary) is determined by promotion score, not by who is reading the channel.

---

## 8. CLV Display Policy

CLV (`capperClvPct`) is shown in pick embeds only when it is available in `pick.metadata.capperClvPct`. It is appended to the Capper field as `| CLV: +X.X%`.

CLV is historical context (how a prior pick closed relative to the opening line), not a forward-looking signal. It should not be described as "edge."

CLV is not shown in recap embeds.

---

## 9. Receipt Type by Embed Type

| Embed type | receiptType |
|-----------|-------------|
| Pick delivery (live) | `discord.message` |
| Pick delivery (dry-run) | `discord.message` (dryRun flag in payload) |
| Simulation | `worker.simulation` |
| Recap delivery | `discord.message` |

---

## 10. Stale / Superseded Docs

The following documents are marked DESIGN INTENT and are superseded by this contract for public embed behavior:

- `docs/discord/discord_embed_system_spec.md` — marked DESIGN INTENT; runtime is authoritative
- `docs/02_architecture/tier_system_design_spec.md` — marked NOT YET CALIBRATED; tier display policy is in Section 7 of this contract

For architectural tier definitions (scoring weights, calibration), see `@unit-talk/contracts` and `@unit-talk/domain`.
