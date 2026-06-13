# UTV2-1272 — `missing_event_context` Diagnostic + Production Truth Map Addendum

**Date:** 2026-06-13 · **Branch:** `claude/utv2-1272-appenv-scheduling-and-clv-diagnostic`
**Mode:** read-only live diagnosis (Supabase `zfzdnfwdarxucxtaojxm`). No rows mutated. No resolver semantics changed.
**Reproduce:** `npx tsx apps/api/src/scripts/utv2-1272-missing-event-context-diagnostic.ts`

This addendum extends `docs/06_status/planning/PRODUCTION_TRUTH_MAP.md` §3 (blocker B3) with proven evidence.

---

## Headline

Forward-flow `closing_for_clv` = 0 is **not** a CLV-resolver defect and **not** a `provider_offers`
staleness issue. It is, in order of magnitude:

1. **The dominant `missing_event_context` mass is `band=SUPPRESS` orphan picks** that are excluded from
   evidence by contract — failing CLV closed on them is correct behavior.
2. **For evidence-eligible, well-formed player props, CLV computes successfully.**
3. **Forward-flow `closing_for_clv`=0 is a volume/timing condition:** no evidence-eligible pick has
   reached `computed` CLV *since* the UTV2-1262 forward-flow write path deployed (~2026-06-12). The
   45 recent computed CLVs all predate that write path and were captured only by the UTV2-1262 backfill.

---

## Evidence (live SQL, last 30 days unless noted)

### 1. Break-layer of `missing_event_context` (entity-resolution chain pick → participant → event_participants → events.external_id)

| break_layer | n |
|---|---|
| `3_no_participant_ref` (no `participant_id` FK AND no `metadata.player`) | **1,907** |
| `5_participant_not_linked_to_event` | 6 |

→ 99.7% is the pick having **no participant reference at all**, so `resolveParticipantId()`
(`apps/api/src/clv-service.ts:601`) returns null → `resolvePickEventContext()` returns null →
`status='missing_event_context'` (`clv-service.ts:284-291`). Zero failures at the provider-table or
`external_id` layer.

### 2. What those orphan picks are

| market | market_type_id | source | n | null participant_id | has player/playerId/eventId keys |
|---|---|---|---|---|---|
| `points-all-game-ou` | `player_points_ou` | null | **1,147** | 1,147 | 0 / 0 / 0 |
| `player_points_ou` | `player_points_ou` | null | 6 | 0 | 6 / 6 / 5 |

The 1,147 dominant orphans:
- **All `band=SUPPRESS`** (1147/1147).
- `selection` is a placeholder: **"Player Over 21.5"** (no real player identity).
- metadata keysets: `band, domainAnalysis, eventName, kellySizing, submittedBy` (+`deviggingResult`) —
  **no `player`, `playerId`, `participant_id`, or `eventId`**.
- 0 `testRun`, 0 `t1-proof`/replay. Window 2026-05-22 → 2026-06-12.

Per the evidence-eligibility contract (`docs/02_architecture/PICK_LIFECYCLE_AND_EVIDENCE_MODES.md`),
`band:SUPPRESS` picks are **excluded from evidence**. They should not and cannot compute CLV. This is
correct fail-closed behavior.

### 3. CLV status for EVIDENCE-ELIGIBLE settlements (excl. `band=SUPPRESS`, `testRun`, `t1-proof`)

`computed` CLV appears across many well-formed player-prop markets:
`player_assists_ou` (6), `player_batting_hits_ou` (6), `player_batting_total_bases_ou` (3),
`player_batting_walks_ou` (3), `player_3pm_ou` (3), `player_blocks_ou` (2), `player_batting_rbi_ou` (2),
plus `player_pts_rebs_ou`, `player_pra_ou`, `player_rebs_asts_ou`, `player_pts_asts_ou`,
`player_batting_home_runs_ou` … (~31 computed total for player props, +15 non-prop computed).
Residual eligible failures are lower-volume `missing_closing_line` (~24) and `missing_priced_side` (~3).

→ **The forward-flow CLV path works for well-formed evidence-eligible player props.**

### 4. Forward-flow `closing_for_clv` snapshot vs `computed` CLV (last 14 days, eligible)

| metric | value |
|---|---|
| eligible settlements with `clvStatus=computed` | 45 |
| …with any `closing_for_clv` snapshot | 45 |
| …with a **forward-flow** (non-backfill) snapshot | **0** |
| latest such settlement | **2026-06-11** |

All 45 snapshots are `backfill_source=UTV2-1262-historical`. The latest eligible computed-CLV settlement
is **2026-06-11**, *before* the UTV2-1262 forward-flow write path deployed (~2026-06-12). So there has
been **no qualifying settlement since the write path went live** — the forward-flow write is simply
**unexercised**, not broken.

---

## Conclusion for Wave 2

- **No CLV-resolver code change is warranted by this evidence** (guardrail: no resolver semantics without PM gate — none proposed).
- The forward-flow `closing_for_clv` write path (UTV2-1262) needs **a qualifying evidence-eligible
  player-prop settlement after 2026-06-12** to confirm it fires. This is gated by settlement volume of
  non-SUPPRESS, well-formed picks (itself influenced by the P7A brake holding picks in `awaiting_approval`).
- Secondary, lower-volume eligible blocker: `missing_closing_line` for some markets — candidate for
  UTV2-1264/1265 (game totals/spreads) and UTV2-1268 (native close fields) once Wave 2 confirms forward flow.
- **Trivial follow-up (not done here, to avoid touching the resolver under guardrail):** stale comments in
  `apps/api/src/clv-service.ts:305,338-340` say "provider_offers" but the read targets `provider_offer_history`.

## Canonical data-source map (confirmed — Wave 1 item 4)

`provider_offer_history` CANONICAL/fresh (CLV closing-line source) · `provider_offer_current` CANONICAL/fresh ·
`market_universe` CANONICAL/fresh (CLV rank-1 + rank-4) · `pick_offer_snapshots` CANONICAL (CLV snapshot, UTV2-1262) ·
**`provider_offers` LEGACY/FROZEN since 2026-04-29 (UTV2-772 cutover) — not written, not read; do not revive.**
