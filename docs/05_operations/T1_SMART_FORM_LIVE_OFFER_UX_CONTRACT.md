# T1 Smart Form Live-Offer-First UX Contract

**Status:** RATIFIED — 2026-04-02
**Issue:** UTV2-271
**Authority:** T1 product/UX contract. Owned by PM (A Griffin).
**Lane:** Claude (design). Codex (implementation).
**Cross-references:** `T1_CANONICAL_BETTING_TAXONOMY_CONTRACT.md`, `T1_CANONICAL_MIGRATION_AND_COMPATIBILITY_CONTRACT.md`, `T1_REFERENCE_DATA_SEEDING_AND_RECONCILIATION_POLICY.md`, Codex PRs #130–#133

---

## Purpose

Define how Smart Form operates in live-offer-first mode with manual completion fallback. The form should feel as sportsbook-like as possible when provider data exists, and degrade gracefully to manual entry when it doesn't. All paths must be bound to canonical entities.

---

## 1. Primary Operating Rule

**Live offer mode is the default path. Manual entry is fallback only.**

| Principle | Rule |
|-----------|------|
| Default behavior | Smart Form presents live matchups and offers from `provider_offers` overlaid on canonical entities |
| Fallback trigger | Manual entry activates only when: (a) no live offers exist for the selection, or (b) the capper explicitly switches to manual mode |
| Canonical binding | Every submission — whether from a live offer or manual entry — must resolve to canonical sport, league, team (when applicable), player (when applicable), market type, and sportsbook |
| Provider-label suppression | Provider-specific labels (SGO market keys, Odds API bookmaker IDs) are never shown to the user. All display uses canonical `display_name` fields. |

---

## 2. Browse Flow

### Target flow: live-offer-first

```
1. Select date (default: today)
       ↓
2. Select sport (from canonical sports where active=true)
       ↓
3. View matchup list (canonical events for date + sport with live offer counts)
       ↓
4. Select matchup → expand to detail view
       ↓
5. Select market family (moneyline / spread / total / player prop / team prop)
       ↓
6. If player prop: select player (from event roster via canonical player_team_assignments)
       ↓
7. Browse available books + lines + odds for the selected market
       ↓
8. Select specific line + book → auto-populate odds, line, book, market fields
       ↓
9. Enter confidence (slider 1–10)
       ↓
10. Submit
```

### Step details

#### Step 1: Date selection

| Behavior | Detail |
|----------|--------|
| Default | Today's date |
| Range | Today through +7 days (configurable) |
| Past dates | Not selectable (picks are pre-game only) |
| Data source | Static (date picker UI) |

#### Step 2: Sport selection

| Behavior | Detail |
|----------|--------|
| Source | `GET /reference-data/catalog` → `sports` array |
| Filter | `active = true` |
| Display | `display_name` (e.g., "NBA", "NFL") |
| Ordering | `sort_order` |
| Empty state | Should never be empty (static seed guarantees sports) |

#### Step 3: Matchup list

| Behavior | Detail |
|----------|--------|
| Source | `GET /reference-data/matchups?sport={sport}&date={date}` |
| Display | Each matchup: `{away_team.short_name} @ {home_team.short_name}` + game time + live offer count |
| Live offer count | Number of distinct `provider_offers` rows for this event in the last 30 minutes |
| Badge | "LIVE" badge if live offers exist; no badge if none |
| Empty state | "No matchups scheduled for {date}" with option to switch to manual mode |
| Large slates (>15 matchups) | Show scrollable list; no search needed at this count |
| Very large slates (>30) | Add text filter at top of list |

#### Step 4: Matchup detail

| Behavior | Detail |
|----------|--------|
| Source | `GET /reference-data/events/{eventId}/browse` |
| Display | Full team names, game time, venue (if available), canonical event participants |
| Subview | Market family tabs/grid below matchup header |

#### Step 5: Market family selection

| Behavior | Detail |
|----------|--------|
| Source | `sport_market_type_availability` filtered by `sport_id` |
| Display | Grid/tabs: Moneyline, Spread, Total, Player Props, Team Props |
| Behavior | Selecting a family filters the offer display below to that family |
| Props expansion | Player Props expands to show player list (Step 6) |

#### Step 6: Player selection (player props only)

| Behavior | Detail |
|----------|--------|
| Source | Event participants from browse API → filter to `participant_type = 'player'` |
| Grouping | Group by team: "Lakers" players, then "Celtics" players |
| Fallback | If no canonical players for this event: show autocomplete search against `GET /reference-data/search/players?sport={sport}` |
| Display | `{player.display_name}` with team badge |

#### Step 7: Browse offers

| Behavior | Detail |
|----------|--------|
| Source | Latest `provider_offers` for the selected event + market + participant |
| Grouping | Group by canonical sportsbook → show line + odds per book |
| Display | Table: Book | Line | Over | Under (or Home | Away for moneyline) |
| Best line highlight | Highlight the best odds across books (optional — P2) |
| Refresh | Auto-refresh every 60 seconds (or manual refresh button) |
| Empty state | "No live offers for this market" → auto-transition to manual entry fields |

#### Step 8: Select offer → auto-populate

| Behavior | Detail |
|----------|--------|
| Tap/click on a book's line/odds | Auto-populates: sportsbook, line, odds, market type |
| Editable | All auto-populated fields remain editable (capper may adjust) |
| Override | Capper can change odds/line after selection (e.g., got a better line) |

#### Step 9: Confidence input

| Behavior | Detail |
|----------|--------|
| Input | Slider 1–10 (or number input) |
| Normalization | Divided by 10 → stored as 0.1–1.0 confidence |
| Required | Yes — every pick must have confidence |

#### Step 10: Submit

| Behavior | Detail |
|----------|--------|
| Payload | Canonical sport, market type, team/player (when applicable), sportsbook, line, odds, confidence, event reference |
| Endpoint | `POST /api/submissions` (existing) |
| Validation | All fields validated against canonical registry before submit |

---

## 3. Manual Completion Fallback

### When fallback activates

| Trigger | Behavior |
|---------|----------|
| No matchups for selected date + sport | Form switches to manual mode automatically |
| No live offers for selected event | Offer browse section shows "No live offers" + manual entry fields appear |
| Capper clicks "Manual Entry" toggle | Entire form switches to manual mode |
| Market exists canonically but no live offer | Manual entry fields for line + odds appear; sport/team/player/market still bound to canonical selections |
| Book exists canonically but no offer from that book | Capper can select any canonical sportsbook from dropdown |
| Niche / alt / combo variant not in live data | Capper selects canonical market type (e.g., `player_pra_ou`), enters line + odds manually |

### What manual mode looks like

Manual mode presents the same canonical selectors but without live offer browsing:

```
1. Sport selector (from canonical sports)
2. League selector (from canonical leagues for sport)
3. Event name / matchup (free text OR canonical event selector)
4. Team (from canonical teams for league, or free text if no match)
5. Player (from canonical players via autocomplete, or free text)
6. Market type (from canonical market_types for sport)
7. Stat type / combo stat (from canonical stat_types / combo_stat_types)
8. Sportsbook (from canonical sportsbooks)
9. Line (free text numeric)
10. Odds (free text American odds)
11. Confidence (slider 1-10)
12. Selection (over/under/home/away — from canonical selection types)
```

### Canonical binding in manual mode

**Every manual entry must still resolve to canonical entities:**

| Field | Must be canonical | Fallback if no match |
|-------|------------------|---------------------|
| Sport | Yes (dropdown) | Cannot submit without sport |
| Team | Preferred (dropdown) | Free text allowed; stored in `metadata.teamName` for later resolution |
| Player | Preferred (autocomplete) | Free text allowed; stored in `metadata.playerName` for later resolution |
| Market type | Yes (dropdown from canonical registry) | Cannot submit without market type |
| Sportsbook | Yes (dropdown) | Cannot submit without sportsbook |
| Line | Free text | Required for props/spreads/totals |
| Odds | Free text | Required |
| Event name | Preferred (canonical event) | Free text allowed; stored as `metadata.eventName` |

---

## 4. Response-Shape Assumptions

### Browse APIs required by Smart Form

Based on the browse API contracts in PR #133:

#### Matchup browse: `GET /reference-data/matchups?sport={sport}&date={date}`

```typescript
interface MatchupBrowseResult {
  eventId: string;
  eventName: string;
  eventDate: string;
  sportId: string;
  status: string;
  homeTeam: { id: string; displayName: string; shortName: string; abbreviation: string } | null;
  awayTeam: { id: string; displayName: string; shortName: string; abbreviation: string } | null;
  liveOfferCount: number;  // count of provider_offers in last 30 min
}
```

#### Event offer browse: `GET /reference-data/events/{eventId}/browse`

```typescript
interface EventBrowseResult {
  event: { id: string; eventName: string; eventDate: string; sportId: string; status: string };
  participants: EventParticipantBrowseResult[];
  offers: OfferBrowseResult[];  // latest offers grouped by book/market/participant
}

interface OfferBrowseResult {
  sportsbook: { id: string; displayName: string };
  marketType: { id: string; displayName: string; shortLabel: string; familyId: string };
  participant: { id: string; displayName: string } | null;  // for player props
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
}
```

#### Canonical fallback selectors

These already exist or are created in PR #133:

| Endpoint | Purpose |
|----------|---------|
| `GET /reference-data/catalog` | Sports, sportsbooks, cappers, market types, stat types |
| `GET /reference-data/leagues?sport={sport}` | Leagues for sport |
| `GET /reference-data/search/teams?sport={sport}&q={query}` | Team autocomplete |
| `GET /reference-data/search/players?sport={sport}&q={query}` | Player autocomplete |

---

## 5. UX States

### State 1: Loaded live slate

**Condition:** Matchups exist for selected date + sport, and live offers exist for at least one event.

**Behavior:**
- Matchup list shows events with "LIVE" badges
- Selecting a matchup shows offer table grouped by book/market
- Tapping an offer auto-populates the submission form
- Confidence slider is the primary remaining user action

**Visual cue:** Green "LIVE" indicators. Offer table populated.

### State 2: Partial live coverage

**Condition:** Some matchups have live offers, others don't. Or a matchup has offers for some markets but not the capper's desired market.

**Behavior:**
- Matchup list shows mixed badges: some "LIVE", some no badge
- Selecting a no-offer matchup shows empty offer table + manual entry fields
- Selecting a live matchup with missing market shows offer table for available markets + "Manual entry" option for the missing market

**Visual cue:** Mixed badges. "No offers for this market — enter manually" prompt.

### State 3: No live coverage

**Condition:** No `provider_offers` exist for the selected date + sport (ingestor down, off-season, niche sport).

**Behavior:**
- Matchup list shows events from `events` table (if populated) with no "LIVE" badges
- If no events either: show "No matchups scheduled" + manual mode auto-activates
- All fields fall back to canonical selectors + manual entry

**Visual cue:** No green indicators. Manual mode prominent.

### State 4: Stale provider state

**Condition:** `provider_offers` exist but latest `snapshot_at` is >30 minutes old.

**Behavior:**
- Show offers but with "STALE" badge (yellow) instead of "LIVE" (green)
- Tooltip: "Odds data is {N} minutes old — verify before submitting"
- Offers still selectable; capper decides whether to use stale odds or override manually

**Visual cue:** Yellow "STALE" badge. Tooltip with age.

### State 5: Empty search result / search fallback

**Condition:** Player search returns no results, or team search returns no results for the selected sport.

**Behavior:**
- Show "No results for '{query}'" message
- Offer free text input as fallback: "Can't find the player? Enter name manually"
- Manual name stored in `metadata.playerName` for later canonical resolution

**Visual cue:** Empty state message with free text escape hatch.

---

## 6. Validation and Submission Rules

### What must be selected from canonical registry

| Field | Live offer mode | Manual mode |
|-------|----------------|-------------|
| Sport | Required (canonical) | Required (canonical) |
| Market type | Auto-populated from offer | Required (canonical dropdown) |
| Sportsbook | Auto-populated from offer | Required (canonical dropdown) |
| Confidence | Required (slider) | Required (slider) |

### What may be manually entered

| Field | Live offer mode | Manual mode |
|-------|----------------|-------------|
| Line | Auto-populated; editable | Required for props/spreads/totals |
| Odds | Auto-populated; editable | Required (American odds format) |
| Event name | Auto-populated from matchup | Free text if no canonical event |
| Team | Auto-populated from matchup | Canonical dropdown preferred; free text fallback |
| Player | Auto-populated from roster | Canonical autocomplete preferred; free text fallback |
| Selection (over/under/home/away) | Inferred from offer context | Required (canonical dropdown) |

### Submission payload requirements

Every submission must include at minimum:

```typescript
{
  source: 'smart-form',
  sport: string,           // canonical sport ID (e.g., 'NBA')
  market: string,          // canonical market type ID (e.g., 'player_points_ou')
  selection: string,       // e.g., 'over', 'under', 'home', 'away'
  odds: number,            // American odds
  confidence: number,      // 0.1–1.0
  sportsbook: string,      // canonical sportsbook ID
  line?: number,           // required for props/spreads/totals
  eventName?: string,      // canonical or free text
  playerName?: string,     // canonical display_name or free text
  teamName?: string,       // canonical display_name or free text
  eventId?: string,        // canonical event UUID (when available)
  playerId?: string,       // canonical player UUID (when available)
  teamId?: string,         // canonical team ID (when available)
  metadata: {
    submissionMode: 'live-offer' | 'manual',
    offerId?: string,      // provider_offer ID if selected from live data
    // ... additional context
  }
}
```

### What must NEVER bypass canonical entities

1. **Sport** — always canonical. No free text.
2. **Market type** — always canonical. If the capper's market doesn't exist in the registry, it cannot be submitted. (Operator adds market types; cappers don't.)
3. **Sportsbook** — always canonical. If the book doesn't exist in `sportsbooks`, it cannot be selected.

---

## 7. Explicit Recommendations

### What Codex should implement first in Smart Form UI

| Priority | Task | Why |
|----------|------|-----|
| **P0** | Date + sport → matchup list from browse API | Foundation of the live-offer-first flow |
| **P0** | Matchup detail with offer table (grouped by book/market) | Core sportsbook-like UX |
| **P0** | Offer tap → auto-populate submission fields | Eliminates manual entry for live offers |
| **P1** | Manual mode toggle + canonical selector fallbacks | Ensures form works when offers are absent |
| **P1** | Live/stale/absent state indicators | User knows data freshness |
| **P2** | Player selector grouped by team from event roster | Improves prop submission UX |
| **P2** | Best-line highlighting across books | Adds value beyond basic browsing |
| **P3** | Auto-refresh offers (60s interval) | Nice-to-have; manual refresh is sufficient initially |

### What can be deferred

| Deferred item | Why |
|---------------|-----|
| Parlay / multi-leg submission | Out of scope; `ticketType: 'single'` is the only enabled type |
| In-play / live betting flow | No live odds streaming; requires WebSocket feed |
| Odds comparison across books for same market | P2 enhancement; basic offer table is sufficient |
| Player stat pre-fill from historical data | Nice-to-have; not needed for MVP |
| Submission templates / quick-repeat | Future convenience feature |

### What should never bypass canonical entities

1. **No free-text sport entry.** Sport is always a canonical dropdown.
2. **No free-text market type entry.** Market type is always a canonical dropdown. If the market doesn't exist, it must be added to the canonical registry by an operator — not invented by the capper.
3. **No free-text sportsbook entry.** Book is always a canonical dropdown.
4. **No submission without at least sport + market + sportsbook + odds + confidence.** These five fields are the minimum viable pick.

---

## Authority and Update Rule

This document is T1. UX flow changes (e.g., adding new submission modes, changing what's canonical vs free-text) require PM approval. UI styling, layout, and non-functional enhancements (animations, loading states) are T3 and may be adjusted freely.
