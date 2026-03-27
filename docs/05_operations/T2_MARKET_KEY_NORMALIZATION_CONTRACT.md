# T2 Market Key Normalization — Implementation Contract

> **Status:** RATIFIED
> **Tier:** T2 — additive; no new migration, no settlement path changes
> **Lane:** `lane:codex` (implementation), `lane:claude` (verification)
> **Issue:** UTV2-33
> **Prerequisite:** UTV2-28 T1 Automated Grading (CLOSED ✅)
> **Ratified:** 2026-03-26

---

## 1. Problem Statement

Discord picks submitted via `/pick` store `picks.market` as a human-readable string (e.g. `"NBA points"`, `"MLB batting hits"`). The grading service looks up `game_results` using `pick.market` as `marketKey`. SGO results ingest (UTV2-30) writes `game_results.market_key` using the SGO stat-namespace format (e.g. `"points-all-game-ou"`, `"batting-hits-all-game-ou"`).

**These two formats do not match.** Without normalization, Discord picks can never be graded — `game_result_not_found` will be returned for all `/pick` submissions.

---

## 2. Normalization Strategy

Normalization happens **at submission time** — when `processSubmission()` is called, the `pick.market` value is canonicalized to the SGO market key format before being stored in `picks.market`.

Rationale: normalization at submission time means the `picks` table always contains canonical market keys; grading, CLV, and any future analytics all read the same normalized value. No retroactive migration needed for new submissions.

> **Note on existing picks:** Picks already stored with human-readable market strings will not be back-filled by this contract. A one-time migration or re-grading pass for legacy picks is out of scope.

---

## 3. Translation Table

### 3.1 Format

The canonical market key format is:

```
{statID}-{entityScope}-{periodID}-{betTypeID}
```

Examples: `points-all-game-ou`, `assists-all-game-ou`, `batting-hits-all-game-ou`

### 3.2 Mapping Table

| Human-readable (`/pick` input) | Canonical market key | Sport |
|---|---|---|
| `NBA points` | `points-all-game-ou` | NBA |
| `NBA assists` | `assists-all-game-ou` | NBA |
| `NBA rebounds` | `rebounds-all-game-ou` | NBA |
| `NBA steals` | `steals-all-game-ou` | NBA |
| `NBA blocks` | `blocks-all-game-ou` | NBA |
| `NBA turnovers` | `turnovers-all-game-ou` | NBA |
| `NBA PRA` | `pra-all-game-ou` | NBA |
| `NBA PR` | `pr-all-game-ou` | NBA |
| `NBA RA` | `ra-all-game-ou` | NBA |
| `MLB batting hits` | `batting-hits-all-game-ou` | MLB |
| `MLB batting home runs` | `batting-home-runs-all-game-ou` | MLB |
| `MLB batting RBI` | `batting-rbi-all-game-ou` | MLB |
| `MLB batting strikeouts` | `batting-strikeouts-all-game-ou` | MLB |
| `MLB batting walks` | `batting-walks-all-game-ou` | MLB |
| `MLB pitching strikeouts` | `pitching-strikeouts-all-game-ou` | MLB |
| `MLB pitching innings` | `pitching-innings-all-game-ou` | MLB |

### 3.3 Unmapped Values

If a market string does not match any entry in the table, it passes through unchanged (stored as-is). This is intentional — do not reject unmapped markets at submission time. Grading will skip with `game_result_not_found` for unmapped markets, which is the correct behavior.

---

## 4. Implementation Location

### 4.1 New File: `packages/domain/src/market-key.ts`

```typescript
// Canonical market key translation table and normalizer.
// Used at submission time to canonicalize human-readable market strings.

export const MARKET_KEY_MAP: Record<string, string> = {
  'NBA points': 'points-all-game-ou',
  'NBA assists': 'assists-all-game-ou',
  'NBA rebounds': 'rebounds-all-game-ou',
  'NBA steals': 'steals-all-game-ou',
  'NBA blocks': 'blocks-all-game-ou',
  'NBA turnovers': 'turnovers-all-game-ou',
  'NBA PRA': 'pra-all-game-ou',
  'NBA PR': 'pr-all-game-ou',
  'NBA RA': 'ra-all-game-ou',
  'MLB batting hits': 'batting-hits-all-game-ou',
  'MLB batting home runs': 'batting-home-runs-all-game-ou',
  'MLB batting RBI': 'batting-rbi-all-game-ou',
  'MLB batting strikeouts': 'batting-strikeouts-all-game-ou',
  'MLB batting walks': 'batting-walks-all-game-ou',
  'MLB pitching strikeouts': 'pitching-strikeouts-all-game-ou',
  'MLB pitching innings': 'pitching-innings-all-game-ou',
};

/**
 * Normalize a human-readable market string to a canonical market key.
 * Returns the input unchanged if no mapping exists.
 */
export function normalizeMarketKey(market: string): string {
  return MARKET_KEY_MAP[market] ?? market;
}
```

### 4.2 Modified File: `apps/api/src/submission-service.ts`

In `processSubmission()`, apply `normalizeMarketKey()` to the `market` field before constructing the pick:

```typescript
import { normalizeMarketKey } from '@unit-talk/domain';

// In processSubmission():
const normalizedMarket = normalizeMarketKey(submission.market);
// Use normalizedMarket when constructing CanonicalPick / saving pick
```

### 4.3 No Other Files Change

No schema changes. No migration. The `picks.market` column type remains `text` — canonical market keys are valid text values.

---

## 5. Acceptance Criteria

- [ ] AC-1: `normalizeMarketKey('NBA points')` returns `'points-all-game-ou'`
- [ ] AC-2: `normalizeMarketKey('unknown market')` returns `'unknown market'` (pass-through)
- [ ] AC-3: All 16 entries in the mapping table produce the correct canonical key
- [ ] AC-4: Picks submitted via `processSubmission()` with a known market string store the canonical key in `picks.market`
- [ ] AC-5: Picks submitted with an unknown market string store the original string unchanged
- [ ] AC-6: `pnpm verify` exits 0; ≥6 net-new tests; total ≥ 557 (baseline 551 + ≥6 net-new)

## 6. Tests Required

### packages/domain tests (≥4)

1. `normalizeMarketKey` — known NBA market → canonical key
2. `normalizeMarketKey` — known MLB market → canonical key
3. `normalizeMarketKey` — unknown market → pass-through unchanged
4. Full table spot-check: 4 randomly selected entries return correct canonical keys

### submission-service tests (≥2)

1. `processSubmission` with `market: 'NBA points'` → stored pick has `market: 'points-all-game-ou'`
2. `processSubmission` with `market: 'exotic market type'` → stored pick has `market: 'exotic market type'` (pass-through)

## 7. Proof Requirements

- [ ] `pnpm verify` exits 0; test count ≥ 557
- [ ] Submit a `/pick` via the smart form or API with `market: 'NBA points'` — confirm `picks.market = 'points-all-game-ou'` in live DB
- [ ] Call `POST /api/grading/run` — pick with canonical market key resolves `game_result_not_found` only if no game_result exists (not due to key mismatch)

## 8. Out of Scope

- Back-filling existing picks with canonical market keys (separate migration, not in this contract)
- Adding new market key entries beyond the 16 defined above (extend table in follow-on T3)
- Market key validation at submission time (unknown keys pass through — no rejection)
- Server-side market key dropdown/enum in `/pick` command (separate UX concern)

## 9. Dependency Chain

- UTV2-28 (T1 Automated Grading) — **CLOSED** ✅
- UTV2-35 (this contract) — **RATIFIED** ✅
- UTV2-33 (implementation) — **READY** upon this contract ratification
