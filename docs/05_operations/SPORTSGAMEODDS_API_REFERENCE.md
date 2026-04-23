# SportsGameOdds API Reference

> Purpose: fast implementation reference for SGO provider ingest, historical odds, CLV proof, and
> R1-R5 replay work.
>
> Status: provider reference for UTV2-730 / SGO MCP proof support.
>
> Last checked: 2026-04-23 against the public SGO LLM docs.

## Source of Truth

Do not guess SGO field names or endpoint parameters. Use these resources first:

| Resource | URL | Use |
| --- | --- | --- |
| Documentation index | https://sportsgameodds.com/docs/llms.txt | Quick map of all SGO docs pages |
| Full LLM docs | https://sportsgameodds.com/docs/llms-full.txt | Detailed endpoint, field, and example reference |
| OpenAPI spec | https://sportsgameodds.com/docs/SportsGameOdds_OpenAPI_Spec.json | Exact request/response schema proof |
| Events endpoint docs | https://sportsgameodds.com/docs/endpoints/getEvents | Event, odds, score, result, and historical line queries |

If docs or MCP access is unavailable, stop and ask for the relevant excerpt instead of inventing a
provider contract.

## Authentication

SGO requires an API key. Treat it as a secret.

Supported request forms:

```text
x-api-key: <SGO_API_KEY>
```

```text
https://api.sportsgameodds.com/v2/events?apiKey=<SGO_API_KEY>
```

Local MCP config should use env substitution, not a literal key:

```json
{
  "mcpServers": {
    "sports-game-odds": {
      "command": "npx",
      "args": ["-y", "sports-odds-api-mcp@latest"],
      "env": {
        "SPORTS_ODDS_API_KEY_HEADER": "${SGO_API_KEY}"
      }
    }
  }
}
```

## Response Shape

All responses are JSON. The primary payload is returned under `data`.

Cursor-based endpoints may include `nextCursor`; continue fetching while `nextCursor` is present
when building coverage or replay evidence.

## Primary Endpoint

```text
GET https://api.sportsgameodds.com/v2/events
```

This is the primary endpoint for live/upcoming odds, historical odds, scores, stats, and results.
Use query filters aggressively to control response size and provider cost.

Common parameters:

| Parameter | Example | Use |
| --- | --- | --- |
| `leagueID` | `NBA,MLB,NHL` | Limit to specific leagues |
| `oddsAvailable` | `true` | Live/upcoming events with available odds |
| `oddID` | `points-all-game-ou-over` | Limit to exact markets |
| `includeAltLines` | `true` | Include alternate spread and over/under lines |
| `includeOpenCloseOdds` | `true` | Include historical open/close fields for CLV proof |
| `includeOpposingOdds` | `true` | Include paired sides where available |
| `finalized` | `true` | Completed/finalized result-side event proof |
| `cursor` | `<nextCursor>` | Pagination |
| `limit` | `100` | Page size |

## Event Fields

Key event fields used by Unit Talk:

| Field | Meaning |
| --- | --- |
| `eventID` | SGO event identifier |
| `sportID` | Sport identifier, e.g. `BASKETBALL`, `BASEBALL`, `HOCKEY` |
| `leagueID` | League identifier, e.g. `NBA`, `MLB`, `NHL` |
| `teams.home.teamID` | SGO home team identifier |
| `teams.away.teamID` | SGO away team identifier |
| `status.startsAt` | Event start time |
| `status.started` | Event has started |
| `status.ended` | Event has ended |
| `status.finalized` | Event data has been finalized |
| `players.<playerID>` | Participating player metadata |
| `odds` | Odds markets keyed by `oddID` |
| `results` | Final result/stat payload when available |

For settlement and result proof, prefer finalized events and verify actual live payload shape before
normalizing new leagues or markets.

## OddID Format

`oddID` identifies a specific outcome on a market:

```text
{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}
```

Examples:

| oddID | Meaning |
| --- | --- |
| `points-home-game-ml-home` | Full-game home moneyline |
| `points-away-1h-sp-away` | First-half away spread |
| `points-all-game-ou-over` | Full-game total points over |
| `assists-LEBRON_JAMES_1_NBA-game-ou-over` | LeBron James assists over |

Implementation note: provider offer identity should preserve enough of the SGO oddID and bookmaker
identity to distinguish side, period, stat entity, open/close source, and alt-line variants.

## Bookmaker Odds Path

Bookmaker prices live at:

```text
odds.<oddID>.byBookmaker.<bookmakerID>
```

Common bookmaker fields:

| Field | Meaning |
| --- | --- |
| `odds` | Current American odds |
| `available` | Market availability |
| `spread` | Current spread value for spread markets |
| `overUnder` | Current total/prop line for over/under markets |
| `deeplink` | Bookmaker market URL when supplied |
| `altLines` | Alternate lines when `includeAltLines=true` |
| `lastUpdatedAt` | Price/line update timestamp when supplied |

Open/close fields are only expected when `includeOpenCloseOdds=true`:

| Field | Meaning |
| --- | --- |
| `openOdds` | First available odds at that book |
| `closeOdds` | Odds at event start time at that book |
| `openSpread` | Opening spread |
| `closeSpread` | Closing spread |
| `openOverUnder` | Opening total/prop line |
| `closeOverUnder` | Closing total/prop line |

These fields are the key SGO-native path for CLV proof. Do not infer close from latest odds unless
the issue explicitly calls for a fallback model and labels it as such.

## Common Identifiers

Sport IDs:

| ID | Sport |
| --- | --- |
| `BASKETBALL` | Basketball |
| `FOOTBALL` | Football |
| `BASEBALL` | Baseball |
| `HOCKEY` | Hockey |
| `SOCCER` | Soccer |
| `TENNIS` | Tennis |
| `GOLF` | Golf |

League IDs:

| ID | League |
| --- | --- |
| `NBA` | NBA |
| `NFL` | NFL |
| `MLB` | MLB |
| `NHL` | NHL |
| `EPL` | Premier League |
| `UEFA_CHAMPIONS_LEAGUE` | Champions League |
| `NCAAB` | Men's College Basketball |
| `NCAAF` | College Football |

Bookmaker IDs commonly relevant to Unit Talk:

| ID | Bookmaker |
| --- | --- |
| `draftkings` | DraftKings |
| `fanduel` | FanDuel |
| `bet365` | Bet365 |
| `circa` | Circa |
| `caesars` | Caesars |
| `betmgm` | BetMGM |
| `betonline` | BetOnline |
| `prizepicks` | PrizePicks |
| `pinnacle` | Pinnacle |

Bet type and side IDs:

| betTypeID | Meaning | Valid sideIDs |
| --- | --- | --- |
| `ml` | Moneyline | `home`, `away` |
| `sp` | Spread | `home`, `away` |
| `ou` | Over/Under | `over`, `under` |
| `eo` | Even/Odd | `even`, `odd` |
| `yn` | Yes/No | `yes`, `no` |
| `ml3way` | Three-way moneyline | `home`, `away`, `draw`, `away+draw`, `home+draw`, `not_draw` |

Period IDs:

| ID | Period |
| --- | --- |
| `game` | Full game |
| `1h` | First half |
| `2h` | Second half |
| `1q` | First quarter |
| `2q` | Second quarter |
| `3q` | Third quarter |
| `4q` | Fourth quarter |

Common stat IDs:

| ID | Meaning |
| --- | --- |
| `points` | Winner/scoring stat for game markets; points/goals/runs depending on sport |
| `rebounds` | Rebounds |
| `assists` | Assists |
| `steals` | Steals |
| `receptions` | Receptions |
| `passing_yards` | Passing yards |
| `rushing_yards` | Rushing yards |
| `receiving_yards` | Receiving yards |

## CLV and Replay Implications

For UTV2-721 through UTV2-730, the minimum usable historical/replay row needs:

| Need | SGO source |
| --- | --- |
| Event identity | `eventID`, `leagueID`, teams, `status.startsAt` |
| Pick/offer market identity | `oddID`, `statID`, `statEntityID`, `periodID`, `betTypeID`, `sideID` |
| Book identity | `bookmakerID` from `byBookmaker` |
| Opening evidence | `openOdds` plus `openSpread` or `openOverUnder` when applicable |
| Closing evidence | `closeOdds` plus `closeSpread` or `closeOverUnder` when applicable |
| Settlement evidence | finalized event `results` / score fields |
| Player/team join | SGO `playerID` or `teamID`, then canonical alias/entity resolution |

Daily high-volume model proof should separate these gates:

1. Provider coverage: SGO returned enough events/offers/open/close/result rows.
2. Join readiness: provider participants and events join to canonical Unit Talk entities.
3. Replay readiness: scored candidates can be paired with open, close, and final result evidence.
4. Model trust: R1-R5 buckets are evaluated against CLV, ROI, win rate, and drawdown thresholds.

Historical data counts only when the row can be replayed without leaking future information into the
score timestamp. Opening/closing/result fields may exist in the same historical API response, but
the replay harness must treat them as evidence for grading and CLV, not as features available when
the original pick would have been made.
