# PROOF: UTV2-1745

MERGE_SHA: f616d5cb88e414303ae3d43063421c85df450b4a

Retrospective, read-only audit of whether the production pick population can
support a trustworthy-pick claim.

**Lane verdict: it cannot.** Of 107,858 picks in production, exactly **1** is
simultaneously non-fixture, fully identity- and provenance-complete, and
settled. This lane performs no remediation: no regrade, backfill, CLV
persistence, replay, or production write of any kind.

## Verification

ASSERTIONS:

- [x] The production transport exposes only HTTP `GET`. `ReadOnlyPostgrestClient`
      has no write method, so it cannot issue a PostgREST mutation even when the
      supplied credential carries broader rights.
- [x] `PickTruthAuditReport.read_only` is **measured, not asserted**. It is
      derived from `ReadOnlyPostgrestClient.transportEvidence()`, a tally of the
      HTTP methods the client actually issued, so `database_writes_performed` is
      a count of non-GET requests rather than a hardcoded `0`. A literal cannot
      be falsified by a real write; a tally can.
- [x] The audit refuses an unexpected target: `parseCli` rejects any URL whose
      hostname is not `<project-ref>.supabase.co`, so a misconfigured
      environment cannot silently point the audit at another database.
- [x] Grade recomputation is independent — it derives win/loss/push from
      `game_results.actual_value` against the pick's own line and selection
      side, rather than trusting the stored `status`.
- [x] CLV failures are named, not collapsed: a pick with event context but no
      closing offer is classified `missing_closing_line`, not
      `missing_event_context`. Distinguishing these is what separates a data-gap
      from a resolver bug.
- [x] **P1-A — the referenced `game_results` row is proven to belong to the
      pick.** Pick identity (event, participant, market) is established from
      pick metadata, `market_universe` provenance, the canonical
      `events`/`participants` tables and `provider_market_aliases` *before* the
      referenced row is consulted. `buildPickIdentityContext` takes no game
      result argument at all, so the circular path
      (`gameResult.event_id` -> event -> validate that same row) is structurally
      unavailable. A real-but-wrong `game_results` id therefore cannot produce
      an apparent grading agreement.
- [x] **P1-A fails closed with named reasons.**
      `game_result_event_mismatch`, `game_result_participant_mismatch`,
      `game_result_market_mismatch`, `game_result_identity_unverifiable`.
      Uncertainty is never treated as agreement.
- [x] **P1-B — CLV reads the canonical production closing-line source.** The
      audit queries `provider_offer_history`, not the legacy/frozen
      `provider_offers`, and mirrors
      `DatabaseProviderOfferRepository.findClosingLine`
      (`packages/db/src/runtime-repositories.ts`) filter-for-filter: provider
      event identity, provider market identity, participant `eq`/`is null`
      semantics, `snapshot_at <= before` closing cutoff, `order snapshot_at
      desc limit 1`, and `apps/api/src/clv-service.ts`'s pinnacle-then-consensus
      bookmaker preference with the `market_universe` fallback last. The closing
      cutoff mirrors production's `readEventStartTime`
      (`metadata.starts_at`, else `event_date + 'T23:59:59Z'`) **and** its
      `readRetainedEventStartTime`: on the event-scoped-total path production
      prefers the start time retained on the pick
      (`metadata.eventStartTime`/`eventTime`), so the audit does too. Using the
      event-derived value there would send a *later* cutoff than production and
      could select an in-play snapshot production never sees.
- [x] **P1-B remains read-only and inside the audit.** No file under
      `packages/db/**`, `apps/api/**`, `supabase/migrations/**` or any runtime
      production path is modified; the transport is still GET-only.
- [x] **P1-A ports production's drift guard.** `isEventScopedTotalPick`
      reproduces `apps/api/src/clv-service.ts` in full: a pick whose
      `market_type_id` names a game total but which also carries a `player_*`
      market, a `participant_id`, or `player`/`playerId`/`providerParticipantId`
      metadata is **not** event-scoped. Without it, a drifted pick would be
      allowed a null-participant `game_results` row and could still agree.
- [x] **P1-A narrows market identity and detects contradiction.** Candidate keys
      are `{pick-side provider market key, canonical market key}` only — not a
      union of every claim the pick makes — and any additional, non-aliasable
      market claim sets `marketIdentityConflict`, which fails closed as
      `game_result_identity_unverifiable`.
- [x] **P1-B mirrors production's resolution ORDER, not just its filters.** The
      `market_universe` provenance short-circuit runs *before* event context,
      cutoff and participant resolution, exactly as `clv-service.ts` does, and
      the offer-lookup market key is resolved through the alias table only —
      never through pick metadata — via `resolveProductionMarketKey`.
- [x] **Alias resolution is deterministic.** `buildProviderMarketKeyIndex` sorts
      by production's `providerMarketKeyPriority` (`-all-game-` < `-game-` <
      `-all-` < other) then `localeCompare`, instead of last-wins `Map`
      insertion order.
- [x] **A pick-side market claim cannot validate itself.** The candidate set is
      seeded only from the canonical market column and its provider spelling in
      `provider_market_aliases`. An earlier revision seeded it from
      `market_universe.provider_market_key` and `metadata.providerMarketKey` and
      then re-checked those same claims against the set they had populated, so a
      pick naming a different market in metadata could admit a real
      `game_results` row for that other market and book a fabricated agreement.
      Pick-side provenance may seed identity only when the alias table has no
      mapping at all, and only when every provenance claim agrees.
- [x] **Structural classification does not invent a moneyline defect.**
      Production sends a null participant for moneyline as well as for
      event-level totals, so `usesNullParticipantForClosingLookup` — not
      `eventScoped` — decides whether a missing participant is structural.
- [x] **The odds gate is exactly production's.** `!Number.isFinite(pick.odds ??
      null)`; an extra `|| pick.odds === 0` had been refusing a pick production
      still prices.
- [x] **Participant null-semantics match each production call site.**
      `createClosingOfferLookup` branches on `=== undefined || === null`
      (`findClosingLine` narrows `undefined` to `null` first) and
      `createMarketUniverseClosingLookup` on `=== null`
      (`findClosingLineByProviderKey`), so an empty-string participant id is an
      `eq` filter, not `is.null`.
- [x] **A pick with no event row is still eligible when production would resolve
      it.** `resolveEventScopedTotalContext` resolves from
      `metadata.providerEventId` plus a retained start time with no event row at
      all, so requiring an event row would have denied CLV production does have.
- [x] **A null participant issues the query production issues.** `computeCLVOutcome`
      passes `providerParticipantId` — possibly `null` — straight into
      `findClosingLine`, which filters `is(provider_participant_id, null)`.
      Production never bails. The audit's earlier `missing_participant_context`
      refusal attributed a data gap to a participant-resolution defect, and named
      a class that is not a member of production's `CLVComputationStatus` at all,
      so the persisted-status comparison ran against a state production could
      never have persisted. The class is gone; the test asserts the captured
      `is.null` filter, so the receipt is that the query was actually issued.
- [x] **Zero closing odds are `missing_priced_side`, as production reports them.**
      `readClosingSideOdds` gates on `Number.isFinite` alone — but it returns the
      raw number, and both callers test it for truthiness
      (`if (!pricedSide) return 'missing_priced_side'`, `clv-service.ts:415` and
      `:542`). Zero is falsy. Round 4 read the helper in isolation, priced zero
      odds, and thereby claimed CLV production does not have while suppressing a
      real persisted-status mismatch; the fourth review caught it. Production
      holds no zero-priced closing rows today, so no measured figure moved — the
      correction is to the semantics, not the count.
- [x] **The moneyline decline names the path that actually applies.**
      `buildCLVContextFromGradingEvent` never sets `participantSide`, so no
      moneyline pick on this cohort's path can reach `computed` — which is what
      `moneyline_clv_unreachable_on_grading_path` asserts. It does **not** always
      terminate at `missing_selection_side`: `clv-service.ts` returns
      `missing_closing_line` first when no closing line exists, and reaches the
      `participantSide` check only after finding one. An earlier wording of this
      assertion named that wrong terminal status. The previous *reason name*
      blamed an `event_participants` lookup the audit had simply not performed.
- [x] **An unresolvable grading context fails closed rather than downgrading.**
      Substituting `events.external_id` would resolve where production's fallback
      (`resolvePickEventContext`, which additionally needs a resolved participant,
      `event_participants` links and `chooseEventForPick` proximity selection)
      returns `missing_event_context`. Named `grading_context_unresolvable`.
- [x] **A truncated page is refused, and completeness is established by exact
      count rather than by page length.** `readByIds` budgets
      `idsChunk.length * rowsPerId` for the whole chunk, so a few ids with many
      rows could push the rest off the end — and a truncated read makes an
      ambiguous `events.external_id` look *unique*, failing open in exactly the
      place the ambiguity guard exists to close. Comparing `rows.length` against
      the limit does **not** detect this: PostgREST caps every response at the
      project's `max_rows` setting, so above that cap a truncated page arrives
      *shorter* than the limit and reads as complete. That was round 5's guard and
      it was itself fail-open. The shipped guard sends `Prefer: count=exact` and
      compares the rows read against the true matching total from
      `content-range`, which is exact regardless of any server cap; a missing
      count is refused rather than assumed complete. The same check covers the
      forward and reverse `provider_market_aliases` pages. The participants
      name-fallback pager takes the same principle in the form a paged read
      needs — its loop is driven by the exact total instead of by
      `rows.length < PAGE`.
- [x] **A provider market key owned by another market cannot seed identity.**
      A reverse alias index (`provider_market_key` -> owning `market_type_id`)
      is loaded, and a claimed key owned by a different `market_type_id` sets
      `marketIdentityConflict`. Without it, any pick whose canonical market has
      no alias row could seed the candidate set from its own claim — the
      self-validation defect, relocated behind the unmapped branch. A key that
      no `market_type_id` claims may still seed, so genuinely unmapped picks are
      not over-refused.
- [x] **CLV resolves the event the way production's grading path does.** This
      cohort is `source='grading'`, written by `recordGradedSettlement`
      (`apps/api/src/settlement-service.ts`), which passes `preResolvedContext`
      and so bypasses `resolvePickEventContext` entirely. The audit mirrors
      `buildCLVContextFromGradingEvent`: provider event id from
      `events.external_id` keyed by the persisted `gradingContext.eventId`,
      cutoff from that event's `starts_at` (else `event_date + 'T23:59:59Z'`),
      participant from `participants.findById(pick.participant_id)` with
      production's unique-normalized-`display_name` fallback. Reconstructing the
      event instead was denying CLV production has and reporting it as a
      production defect.
- [x] **The grading event is used for CLV only, never for identity.**
      `apps/api/src/grading-service.ts` sets `gradingContext.eventId` to
      `gameResult.event_id`, so admitting it into the P1-A proof would reinstate
      the circularity. A test asserts a wrong-event row stays unverifiable even
      when the grading context names that same wrong event.
- [x] **Round 4 priced zero closing odds; round 5 reverted that.** The round-4
      reasoning ("`readClosingSideOdds` gates on `Number.isFinite` alone") was
      true of the helper and wrong about production, because both callers test
      its raw return for truthiness. The corrected assertion is recorded above.
      It is kept here rather than deleted so the bundle shows what was believed
      and what overturned it.
- [x] **Offer-lookup precedence matches production.** Event id from
      `events.external_id`, then `metadata.providerEventId` — never
      `market_universe.provider_event_id`, which owns the provenance
      short-circuit and not this query. Participant external id from the
      participants table first.
- [x] **An ambiguous `events.external_id` is unverifiable, not a mismatch.** The
      by-external-id index is last-wins; silently selecting one of two events and
      then reporting `game_result_event_mismatch` would assert *contradicted*
      identity where the truth is unproven identity.
- [x] **Selection-side branches run in production's order.** `\bover\b`, then
      `\bunder\b`, then `O<digit>`, then `U<digit>` — not two collapsed
      over/under families, which differ for a selection carrying both.
- [x] **A superseded settlement is never counted as an agreement.**
      `corrects_id IS NULL` excludes the corrections themselves, not the
      settlements they supersede; rows named by a later `corrects_id` fail
      closed as `settlement_superseded_by_correction`.
- [x] **Every correction carries a mutation control, and none survives.**
      Thirty-nine independent, **semantic** mutations each turn at least one
      test red; none relies on a compile error. Three rounds of this battery left
      survivors, and every one was fixed by adding the isolating test rather than
      by weakening the mutation — round 2 left the drift guard and conflict
      detection alive because one combined scenario was blocked by either alone;
      round 4 left `gradingClv = null` alive because the fixture's
      `market_universe` row still pointed at the right event; and round 8 left
      `assertCompletePage` on the **reverse** alias read alive for two
      independent reasons, both in the test. The truncation test truncated *both*
      alias pages, so the forward read threw first and the reverse guard never
      executed; and the loader fixture carried no `market_universe` row and no
      `metadata.providerMarketKey`, so `claimedProviderKeys` was empty and the
      reverse read's loop body never ran at all. A test serving a complete
      forward page beside a truncated reverse one now isolates it. Rounds 5 and 6
      added six mutations, including two that invert round-4 decisions the fourth
      review overturned; round 8 added four covering `loadAuditDataset`. Recorded
      below.
- [x] **The name-fallback candidate pool is scoped by sport, as production
      scopes it.** Production calls `participants.listByType('player',
      metadata.sport)` and `listByType` applies `.eq('sport', sport)` whenever
      sport is truthy, so the pool belongs to the *pick*, not to the cohort. The
      audit had built one flat pool keyed by normalized name alone, collapsing to
      an all-players pool the moment any single pick lacked `metadata.sport` —
      diverging in **both** directions: a name shared across two sports read as
      ambiguous and denied CLV production has (booking a false
      `persisted_computed_but_currently_missing_closing_line` mismatch as it
      went), while the resulting null participant emitted `is.null`, which can
      match an event-scoped history row production's `eq.<player>` query never
      sees. 94.4% of the audited picks carry a null `participant_id`, so this is
      the dominant path, not an edge case. Now keyed `${sport}|${name}`, one pool
      per sport, with the all-players pool fetched only when a pick genuinely has
      no sport.
- [x] **A closing row production would discard skips the tier, not the row.**
      `asClosingLineLike` is mirrored, applied *after* latest-row selection —
      production's query already returned one row, so a bad row makes production
      skip that tier rather than fall back to a second-latest row it never
      fetched.
- [x] **`starts_at` is passed through untrimmed**, because production tests it
      trimmed but returns it raw, and that raw string becomes the `lte.` cutoff.
- [ ] **Recorded divergence, deliberately unfixed:** production's own
      `listByType` paginates on `page.length < PAGE_SIZE`, so production can
      decide name uniqueness on a short pool. The audit refuses instead, and can
      therefore report a participant unresolved where production resolved one.
      This is the fail-closed direction; reproducing a bug in order to agree with
      it would be worse. Named rather than glossed as parity.
- [x] **`loadAuditDataset`'s completeness guards are covered, not merely
      present.** Through round 7 the function was module-private and wholly
      untested: removing `assertCompletePage` from either alias call site, or
      reverting the participants name-fallback pager to a `rows.length`
      terminator, turned no test red. It is now exported and driven end to end by
      a routing fetch stub, with a mutation control on each of its four guards
      and a complete-pages negative control proving the refusals are caused by
      incompleteness rather than by an unusable stub.
- [ ] **Residual, unrepaired:** the shipped CLI has never been executed
      end-to-end against production in this lane — the read key is unavailable
      under containment — so `createClosingOfferLookup`'s real query construction
      is exercised only by fixtures. Stated as a limitation, not closed.
- [x] `pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts` — 52 pass,
      0 fail.

## Runtime Verification

The CLI could not be executed locally: production containment neuters
`local.env` (`SUPABASE_URL=http://127.0.0.1:1`) and this session holds no
production `PICK_TRUTH_AUDIT_READ_KEY`. Live population evidence was therefore
read through the Supabase MCP read path against project `zfzdnfwdarxucxtaojxm`
on 2026-08-26. Every statement below is a `SELECT`.

EVIDENCE:

> **Historical measurement — read-only production measurement from 2026-08-26.**
> Every count below was read once, on 2026-08-26, through the Supabase MCP read
> path against production `zfzdnfwdarxucxtaojxm`. They were deliberately NOT
> re-measured during the 2026-08-30 synchronization with `main`; the historical
> measurement is preserved verbatim and no new SELECT was issued.

```text
SELECT count(*) AS total_picks,
       count(*) FILTER (WHERE participant_id IS NULL)   AS null_participant,
       count(*) FILTER (WHERE line IS NULL)             AS null_line,
       count(*) FILTER (WHERE odds IS NULL)             AS null_odds,
       count(*) FILTER (WHERE market_type_id IS NULL)   AS null_market_type,
       count(DISTINCT status)                           AS distinct_statuses
FROM public.picks;

total_picks | null_participant | null_line | null_odds | null_market_type | distinct_statuses
------------+------------------+-----------+-----------+------------------+------------------
     107858 |           101842 |      8981 |      8588 |            28376 |                 7
```

```text
-- Six-way truth decomposition. "Fixture" is any pick carrying testRun,
-- proof_fixture_id, or proof_issue in metadata.
total                        : 107858
fixture_marked               :  79557   (73.8%)
non_fixture                  :  28301   (26.2%)
has_event      (metadata.eventId)        :   7197   ( 6.7%)
has_participant (col or metadata)        :   6017   ( 5.6%)
has_market_type                          :  79482   (73.7%)
has_line_and_odds                        :  98877   (91.7%)
has_source_provenance (metadata.providerKey) : 7180  ( 6.7%)
settled_at IS NOT NULL                   :  10307   ( 9.6%)
fully_traceable AND non_fixture          :   3055   ( 2.83%)
```

```text
WITH f AS (
  SELECT id,
    NOT ((metadata ? 'testRun') OR (metadata ? 'proof_fixture_id')
         OR (metadata ? 'proof_issue')) AS real_pick,
    (metadata ? 'eventId')
      AND (participant_id IS NOT NULL OR metadata ? 'participantId')
      AND market_type_id IS NOT NULL AND line IS NOT NULL AND odds IS NOT NULL
      AND (metadata ? 'providerKey') AS traceable,
    settled_at IS NOT NULL AS settled, status
  FROM public.picks
)
SELECT count(*) FILTER (WHERE real_pick AND traceable) AS traceable_real,
       count(*) FILTER (WHERE real_pick AND traceable AND settled) AS traceable_real_settled,
       count(*) FILTER (WHERE real_pick AND traceable
                        AND status IN ('won','lost','push','settled')) AS traceable_real_graded
FROM f;

traceable_real | traceable_real_settled | traceable_real_graded
---------------+------------------------+----------------------
          3055 |                      1 |                     2
```

### Unit test output

```text
$ pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts
ok 1 - selection parsing and independent grade recomputation cover over, under, and push
ok 2 - audit itemizes grading disagreements, named CLV failures, and structural blockers
ok 3 - CLV names missing_closing_line instead of assuming missing_event_context
ok 4 - production transport exposes only GET and no write method
ok 5 - P1-A: a real game_results row from the wrong event is unresolvable, never an agreement
ok 6 - P1-A: correct event but wrong participant is unresolvable
ok 7 - P1-A: correct event and participant but an incompatible market is unresolvable
ok 8 - P1-A: a proven event + participant + market recomputes the grade
ok 9 - P1-A: an event-level total with a legitimately null participant stays valid
ok 10 - P1-A negative control: without identity validation the wrong-event row WOULD have agreed
ok 11 - P1-A: pick-side identity never reads the referenced game_results row
ok 12 - P1-B: the audit reads provider_offer_history, never legacy provider_offers
ok 13 - P1-B: snapshots after the closing cutoff are excluded
ok 14 - P1-B: the latest eligible pre-cutoff snapshot is the one selected
ok 15 - P1-B: an event-level market queries a null participant
ok 16 - P1-B: a participant-scoped market requires the matching participant
ok 17 - P1-B: production bookmaker preference and consensus fallback are preserved
ok 18 - P1-B negative control: reverting the lookup to provider_offers fails the controls
ok 19 - a settlement superseded by a later correction is never counted as an agreement
ok 20 - provider market alias resolution is deterministic, mirroring providerMarketKeyPriority
ok 21 - read_only evidence is measured from the transport, not asserted
ok 22 - P1-A drift guard: a game-total market_type_id on a player pick is not event-scoped
ok 23 - P1-A conflict detection: an unaliasable extra market claim is unverifiable
ok 24 - P1-A: a metadata market key cannot validate itself into the candidate set
ok 25 - P1-A: pick-side provenance still seeds identity when the alias table has no mapping
ok 26 - P1-B: the closing cutoff is the pick's retained event start time, not the event date
ok 27 - a moneyline pick with no participant is not a structural blocker
ok 28 - the market_universe closing lookup mirrors findClosingLineByProviderKey
ok 29 - the odds gate mirrors production exactly and does not refuse zero odds
ok 30 - P1-A: a provider market key OWNED by another market cannot seed identity
ok 31 - P1-A: a provider key that no market_type_id owns may still seed identity
ok 32 - P1-B: CLV uses the event production graded against, not a reconstruction
ok 33 - the grading event is used for CLV only, never to prove pick identity
ok 34 - the name-based participant fallback mirrors production uniqueness
ok 35 - the name-fallback pool is scoped to the pick sport, as production scopes it
ok 36 - zero closing odds are missing_priced_side, exactly as production reports them
ok 37 - the offer lookup takes its event id from events.external_id, not market_universe
ok 38 - the participant external id comes from the participants table first
ok 39 - an external_id shared by two events is unverifiable, not a mismatch
ok 40 - selection side branches in production order
ok 41 - a null participant issues the offer query, exactly as production does
ok 42 - a grading context naming an unresolvable event fails closed
ok 43 - a truncated page is refused, even when it is shorter than the limit
ok 44 - a grading context that resolved a null participant is not overridden
ok 45 - the participants name-fallback pool is refused when the server stops short
ok 46 - the participants name-fallback pool is refused when it carries no exact count
ok 47 - a truncated provider_market_aliases page is refused
ok 48 - a complete set of pages loads the dataset, so the refusals above are caused by incompleteness
ok 49 - a truncated reverse provider_market_aliases page is refused
ok 50 - loadAuditDataset builds one candidate pool per sport, and queries each one scoped
ok 51 - a closing row production would discard skips the TIER, not just the row
ok 52 - a whitespace-padded starts_at is passed through untrimmed, as production passes it
1..52
# tests 52
# suites 0
# pass 52
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 467.575298
```

### Mutation controls — each correction is load-bearing

> **Harness note.** The mutation harness was rebuilt on 2026-08-30 after the
> system reaped `/tmp`, destroying the battery scripts and their result files
> mid-sequence. All 39 mutations were reconstructed from source and the harness
> now lives at `.out/mutation/battery.py` (gitignored, inside the repo) so a
> `/tmp` reap cannot break the evidence chain again. The reconstruction is
> recorded because it is weaker evidence than a continuously-maintained battery:
> its first run left ONE survivor, `read_only reverted to asserted literals`,
> and the fault was the reconstruction's — it patched the untested CLI wiring
> site instead of the `read_only` block in the report builder that the test
> actually covers. Repointed at the covered site, it dies. The table below is
> the corrected run.


Every mutation below was applied to `scripts/ops/pick-truth-audit.ts` in
isolation, the suite re-run, and the file restored byte-exact. A control that
cannot fail proves nothing, so each is shown failing.

```text
mutation                                                                       result
---------------------------------------------------------------------------------------------
(none — corrected implementation)                                              52 pass, 0 fail
identity check removed from the grade ladder                                   44 pass, 8 fail
game_result event match dropped                                                49 pass, 3 fail
game_result participant match dropped                                          50 pass, 2 fail
game_result market match dropped                                               51 pass, 1 fail
event-scoped drift guard removed                                               51 pass, 1 fail
market identity conflict detection removed                                     49 pass, 3 fail
provenance re-admitted as an identity seed (self-validating market claim)      50 pass, 2 fail
reverse alias ownership check removed (foreign provider key may seed)          51 pass, 1 fail
grading CLV context ignored (event identity reconstructed instead)             49 pass, 3 fail
name-based participant fallback dropped                                        50 pass, 2 fail
closing table reverted to provider_offers                                      50 pass, 2 fail
snapshot_at closing cutoff dropped                                             48 pass, 4 fail
retained pick-side cutoff ignored (event-derived cutoff used instead)          51 pass, 1 fail
pinnacle bookmaker preference pass dropped                                     51 pass, 1 fail
market_universe participant semantics reverted to truthiness                   51 pass, 1 fail
odds gate over-tightened with `|| pick.odds === 0`                             51 pass, 1 fail
zero closing odds priced (caller falsy-check semantics ignored)                51 pass, 1 fail
null participant bail re-introduced (query production issues is refused)       50 pass, 2 fail
truncated page accepted instead of refused (exact-count guard removed)         51 pass, 1 fail
missing exact count treated as complete                                        51 pass, 1 fail
grading context null participant re-admits the metadata resolver (`??`)        51 pass, 1 fail
unresolvable grading context falls back to a weaker resolver                   51 pass, 1 fail
offer-lookup event id taken from market_universe first                         50 pass, 2 fail
participant precedence reverted to market_universe first                       51 pass, 1 fail
ambiguous external_id resolves to one of the events                            51 pass, 1 fail
selection side branch order collapsed into two families                        51 pass, 1 fail
moneyline structural classification reverted to eventScoped                    51 pass, 1 fail
superseded-correction check removed                                            51 pass, 1 fail
alias priority ordering removed (last-wins Map)                                51 pass, 1 fail
read_only reverted to asserted literals                                        51 pass, 1 fail
participants name-fallback pager reverted to a rows.length terminator          51 pass, 1 fail
participants name-fallback exact-count requirement removed                     51 pass, 1 fail
forward alias completeness assertion removed                                   51 pass, 1 fail
reverse alias completeness assertion removed                                   51 pass, 1 fail
name-fallback pool key reverted to a bare normalized name (all sports pooled)  51 pass, 1 fail
name-fallback LOOKUP ignores the pick sport                                    50 pass, 2 fail
sport pools collapsed to a single all-players pool when any pick lacks sport   51 pass, 1 fail
production closing-line validity gate removed (asClosingLineLike unmirrored)   51 pass, 1 fail
starts_at trimmed, diverging from production's untrimmed passthrough           51 pass, 1 fail
(restored byte-exact)                                                          52 pass, 0 fail
```

### Static verification

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm verify:static
ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
ops:automation-coverage-check, env:check, lint, type-check, build,
pnpm test, smart-form verify, verify:commands
[executable-wiring] verdict=PASS required_roots=verify
EXIT=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff
```

`pnpm verify` is `verify:static && test:live-db`. `verify:static` is green, shown
above. `test:live-db` cannot run in this worktree: production containment sets
`SUPABASE_URL=http://127.0.0.1:1`, and `assert-staging-target` refuses any target
that is not `xskgrzbteyqdufktjrjx`:

```text
$ pnpm test:db
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
```

That is a correct safety refusal, not lane debt. The live-DB receipt for this lane
is produced by CI's `staging-ci` environment inside the required `verify` job.

This lane's own tests are wired into `test:ops` under a PM-authorized scope
extension covering `package.json`, so they execute under required `verify` rather
than only when invoked by hand. No entry was added to
`executable-wiring-baseline.json`: the signal was fixed, not suppressed.

## Post-fix read-only validation (2026-08-30)

Separate from, and additional to, the 2026-08-26 population decomposition above,
which is unchanged and remains the historical measurement. This is a **new,
bounded, read-only** measurement executed with the corrected P1-A/P1-B
semantics, recorded here so the two are never conflated.

**Method — direct replay.** The 200-settlement cohort and every row the loader
reads (settlement payloads including the persisted `gradingContext`, picks,
game_results, events, participants, market_universe, provider_market_aliases in
both directions, and the pre-cutoff `provider_offer_history` snapshots) were
exported read-only from production `zfzdnfwdarxucxtaojxm` through the Supabase
MCP read path. Both the pre-fix and the corrected `buildPickTruthAuditReport`
were then executed over that identical dataset. Both columns below come from
**running the shipped `buildPickTruthAuditReport`**, not from a SQL re-derivation
of its semantics. **No write of any kind was issued.**

One substitution, stated rather than left implicit: the `ClosingOfferLookup`
handed to the report was an **in-memory function over the exported
`provider_offer_history` rows, not the shipped `createClosingOfferLookup`**. The
substitute applies the same four predicates (`provider_event_id`,
`provider_market_key`, participant with `null`-vs-`eq` semantics,
`snapshot_at <= cutoff`) and honours `bookmakerKey`, so pinnacle-then-consensus
precedence *is* exercised — but it returns every matching row instead of the
shipped query's `order snapshot_at desc limit 1`. `selectLatestClosingOffer` then
picks the same row the shipped query would have returned (except on a
`snapshot_at` tie, where it applies an `id` tie-break PostgREST does not), so no
CLV outcome below is affected. What this replay therefore does **not** prove is
the shipped query's own construction — its limit, order clause and emitted filter
strings. Those are covered by unit tests asserting the captured PostgREST
parameters, not by this production run. The two counts in the closing-line block
are candidate rows the substitute surfaced across all calls; the shipped lookup
returns at most one row per call, so they are **not** a count of rows the shipped
query would fetch, and an earlier revision of this bundle mislabelled them as
such.

> Three earlier revisions of this section are superseded, plus the relabelling
> of the closing-line counts described above. All are recorded rather than
> silently replaced.
>
> 1. The pre-fix CLV column was once reported as 44 resolvable (22%), obtained by
>    re-deriving the audit's semantics in SQL. Executing the pre-fix code itself
>    over the same rows yields **4**. The direct replay is authoritative because
>    it exercises the real resolution order rather than a restatement of it.
> 2. The corrected CLV column once showed `missing_event_context` = 99. That was
>    an artifact of the audit reconstructing an event **production never
>    consulted**. Mirroring `buildCLVContextFromGradingEvent` removes the class
>    entirely (**0**) and re-attributes those picks to `missing_closing_line`.
>    Re-measuring required re-exporting the settlement payloads with the full
>    `gradingContext` and fetching `provider_offer_history` for 89 additional
>    (event, market, participant) triples.
> 3. The corrected CLV column once showed `missing_closing_line` = 97 plus
>    `missing_participant_context` = 3. That third class was an audit-invented
>    bail: production passes a possibly-null `providerParticipantId` straight
>    into `findClosingLine`, which filters `is(provider_participant_id, null)`,
>    so production **issues the query**. Removing the bail moves all three to
>    `missing_closing_line` (**100**), which is what production would report, and
>    eliminates a class that is not a member of production's
>    `CLVComputationStatus` at all.

Each of the three revisions replaced a mis-causation with the behaviour
production actually has. The direction of travel is one-way: every correction so
far has removed a reason the audit had invented, and none has been reversed.

Cohort: `settlement_records` where `status='settled'`, `source='grading'`,
`corrects_id IS NULL`, `result IN ('win','loss','push')` and
`evidence_ref LIKE 'game-result:%'`.

```text
grading settlement population        8620
independently auditable population   1571
sample                                200   (100 earliest + 100 latest)
settlements superseded by a later correction   0
```

### Grading — old (circular) vs corrected

```text
                              old      corrected
resolvable                    200            100
agreements                    200            100
disagreements                   0              0
unresolvable                    0            100
agreement rate            100.00%        100.00%

corrected unresolvable, by named reason
  game_result_identity_unverifiable          100
    - no pick-side event identity              99
    - no pick-side market identity              1
  game_result_event_mismatch                   0
  game_result_participant_mismatch             0
  game_result_market_mismatch                  0
```

One caveat belongs with the 100.00% figure before anything is read into it: the
audit's `inferSelectionSide` and `recomputeGrade` reproduce
`apps/api/src/grading-service.ts`'s own formula — deliberately, so that a
disagreement means the data moved rather than that two implementations differ.
Applied to the same `game_results` row, agreement is therefore close to
structurally guaranteed for any settlement current grading code wrote. The
control detects **post-hoc drift in the referenced row** and, since P1-A,
**identity that cannot be proven** — it is not evidence that the grading formula
is correct, and must not be cited as such.

**100 of the 200 apparent agreements were manufactured by the circular event
resolution.** For those picks the only event identity available came from
`gameResult.event_id` — the very row being validated — so the old
implementation proved nothing about them. Where pick-side identity does exist
(100 rows) it agrees with the referenced row in every case: zero event,
participant or market mismatches. The corrected result is a smaller, honest
agreement basis, not a worse one.

Note that `gradingContext.eventId`, which the corrected CLV path *does* use, is
deliberately **not** admitted here. `apps/api/src/grading-service.ts` sets it to
`gameResult.event_id`, so using it for identity would reinstate exactly the
circularity P1-A exists to remove. A test asserts a wrong-event row stays
unverifiable even when the grading context names that same wrong event.

### CLV — legacy `provider_offers` vs production's actual resolver

```text
                              old      corrected
resolvable                      4             98
unresolvable                  196            102
resolvability rate          2.00%         49.00%

failure classes
  missing_closing_line        193            100
  missing_priced_side           2              2
  missing_event_context         0              0
  missing_participant_context   1              0

persisted clvStatus='computed' but currently unresolvable
                              176             82
```

Closing-line evidence for the corrected lookup:

```text
table queried                                provider_offer_history
distinct (event, market, participant) triples requested      167
  with at least one eligible pre-cutoff snapshot              77
  with none                                                   90
candidate rows surfaced by the replay lookup                  191
  of which on the pinnacle pass                               17

legacy provider_offers, total rows                     8,191,206
legacy provider_offers, rows for any sampled event             0
```

All 90 uncovered triples fall in just **8 provider events**, and a direct
unbounded re-query confirms `provider_offer_history` holds **zero** rows for
those 8 events at any time — they are the April 2026 half of the cohort, which
predates the closing-line history. The absence is real, not an export gap.

Old-to-corrected transitions:

```text
old                          corrected                        n
missing_closing_line     ->  missing_closing_line            99
missing_closing_line     ->  resolvable                      94
resolvable               ->  resolvable                       4
missing_priced_side      ->  missing_priced_side              2
missing_participant_ctx  ->  missing_closing_line             1
```

**94** picks the old audit reported as `missing_closing_line` do have a closing
line: the old lookup read the legacy `provider_offers` surface, production reads
`provider_offer_history`. The old audit was under-reporting CLV availability
relative to production.

### The clean split, and why it is the finding

```text
                             identity        CLV               n
earliest 100 (April 2026)    unverifiable    missing_closing_line    100
latest 100 (Jun-Jul 2026)    proven          resolvable               98
                             proven          missing_priced_side       2
```

Every one of the 100 earliest settlements is **both** independently unverifiable
**and** CLV-unresolvable; every one of the 100 latest has provable pick-side
identity, and 98 of them resolve CLV. The defect is a historical cohort with
neither retained identity nor closing-line data — not a fault spread evenly
across the population, and not a resolver bug.

### Effect on the lane verdict

The verdict is **unchanged**: `can_currently_produce_trustworthy_pick: false`.
The materiality rules still fire — the CLV unresolvable rate is 51.00%, at or
above the 10% rule — and the 2026-08-26 population decomposition (1 of 107,858
picks simultaneously non-fixture, identity- and provenance-complete, and
settled) is untouched.

What changes is the **stated cause**, and it changed three times, each time
toward the truth and each change disclosed rather than silently substituted.
The pre-correction bundle attributed the dominant CLV failure to
`missing_closing_line` (193 of 200) — an artifact of querying a frozen legacy
table. The first correction moved the dominant class to `missing_event_context`
(99 of 200), which was in turn an artifact of the audit reconstructing an event
production never consulted; mirroring production's grading-context resolver
removed that class entirely. The second correction removed
`missing_participant_context` (3 of 200), which was an artifact of the audit
*refusing to issue* a query production does issue: `computeCLVOutcome` passes a
possibly-null `providerParticipantId` straight into `findClosingLine`, which
filters `is(provider_participant_id, null)`. That class is not even a member of
production's `CLVComputationStatus`, so the persisted-status comparison had been
running against a state production can never have persisted.

What remains is a single clean historical split with one failure reason per
half: the April 100 have neither provable identity nor any retained closing
line, and the June–July 100 have both. Finding 6 below records this.

## Findings

1. **Event identity is not a first-class field.** `public.picks` has no
   `event_id` column. Event linkage exists only as a camelCase `eventId` key
   inside the `metadata` jsonb, present on 7,197 rows (6.7%). Without event
   identity there is no closing line, no independent regrade path, and no CLV —
   for 93.3% of the population, by construction.

2. **Participant identity is effectively absent.** 101,842 of 107,858 picks
   (94.4%) have a NULL `participant_id`; counting the `metadata.participantId`
   fallback still leaves only 6,017 rows (5.6%) with any participant identity.

3. **The population is majority CI fixture.** 79,557 picks (73.8%) carry an
   explicit fixture marker — `testRun` (60,206), `proof_fixture_id` (19,346), or
   `proof_issue` (19,351). Any aggregate computed over `public.picks` without
   excluding these is measuring the test harness, not the product.

4. **The intersection that matters is empty in practice.** Requiring all of
   non-fixture, event identity, participant identity, standardized market type,
   line and odds, and source provenance leaves 3,055 rows (2.83%). Of those,
   **1** is settled and **2** carry a graded status. There is no population on
   which a trustworthy-pick or ROI/CLV claim could be computed, let alone
   validated.

5. **`game_results` is a usable independent regrade source** (135,249 rows), so
   the blocker is not the absence of outcome data — it is the absence of a join
   key on the pick side. This corrects an earlier reading of `events.metadata`
   alone.

6. **The blocker is a historical cohort, not a live resolver defect.** The
   2026-08-30 post-fix validation shows the closing-line data largely exists —
   94 of 200 sampled picks the pre-correction audit called
   `missing_closing_line` resolve against the canonical
   `provider_offer_history`. Once CLV reads the source production actually reads
   *and* resolves event context the way production's grading path does, and once
   grading proves the referenced `game_results` row belongs to the pick, the
   sample splits exactly in half by age: all 100 April 2026 settlements are both
   independently unverifiable and CLV-unresolvable (their events have no
   retained closing-line history at all), while all 100 June–July settlements
   have provable pick-side identity and 98 resolve CLV. After the round-5
   correction each half fails for exactly one reason — the April 100 are
   uniformly `missing_closing_line`, and the two June–July failures are
   `missing_priced_side` — so no part of the residual is attributable to a
   resolver or participant defect. The remedy is therefore about the historical
   population and about making event identity a first-class field at admission
   (Finding 1), not about the resolver.

## Scope and refusals

Read-only. No regrade, backfill, CLV persistence, replay, production write, or
schema change was performed or is enabled by this lane.

This lane explicitly does **not** attempt to repair the 107,858 historical
picks, and the population must not be represented as trustworthy. Making
forward-flow picks trustworthy is a separate successor and requires, at
admission time and as first-class fields rather than free-form metadata:
explicit event identity, participant identity, standardized selection, line and
source provenance, settlement traceability, and closing-line capture.

## Main synchronization (2026-08-30)

This lane was behind `main` and was resynchronized after UTV2-1785 landed the
pre-proof validator repair. The record below is what the merge actually did.

```text
$ git merge --no-ff --no-commit origin/main     # origin/main = e9f62e5e
Auto-merging package.json
CONFLICT (content): Merge conflict in package.json
$ git diff --name-only --diff-filter=U
package.json
```

`package.json` was the only conflict, and inside it only `scripts.test:ops`.
Both sides append to the same hardcoded list: `main` had gained
`scripts/ops/outbox-triage.test.ts` from UTV2-1744, this lane had added
`scripts/ops/pick-truth-audit.test.ts`. The resolution takes current main's file
verbatim and appends this lane's one entry — 131 whitespace-separated tokens, of
which 128 are test-file arguments (main: 130 tokens / 127 files) — nothing removed, no
formatting churn, no dependency change, no other script changed.

```text
$ git show --format="" HEAD --stat -- package.json
 package.json | 2 +-
$ git show --format="" HEAD          # combined diff: what the merge AUTHORED
diff --cc package.json
++    "test:ops": "... scripts/ops/outbox-triage.test.ts scripts/ops/pick-truth-audit.test.ts",
```

The combined diff of merge commit `149b60ee` contains exactly one file. Nothing
inherited from `main` was re-authored, and
`git diff HEAD origin/main -- docs/06_status/proof/UTV2-1729/` is empty — the
closed historical bundle that originally blocked this merge is untouched.

### Repaired-hook behaviour (both directions)

```text
$ git -C <lane worktree> commit -m "UTV2-1745: sync lane with main; ..."
[codex/utv2-1745-pick-truth-audit 149b60ee] UTV2-1745: sync lane with main; resolve test:ops registration conflict
EXIT=0
```

The merge commit was permitted with no `--no-verify` and no edit to any closed
lane's proof — the inherited-proof false positive is gone.

Positive control, to show the hook did not simply stop validating: this lane's
own `docs/06_status/proof/UTV2-1745/evidence.json` was corrupted
(`verified_source_sha` set to `deadbeef`, `ci_sentinels` removed) and staged.

```text
PROOF VALIDATOR: commit blocked — staged proof bundle has issues (fix and re-commit):
  - [docs/06_status/proof/UTV2-1745/evidence.json] sha_binding.verified_source_sha must be 40 hex chars (got: 'deadbeef')
  - [docs/06_status/proof/UTV2-1745/evidence.json] sha_binding.ci_sentinels missing or empty
```

The file was then restored byte-exact, as were the other three artifacts in this
bundle. Lane-authored proof remains fail-closed; inherited proof is correctly
ignored.

The control was last exercised on the round-3 bundle, and the
`sha256` of `evidence.json` measured immediately after the byte-exact restore
was `d439ac760c8913924521335336bea4f8c6599f4de91e8ab0d5b6cb78b3b470bc`. That
digest is a receipt for *that* restore and is deliberately not updated as the
bundle legitimately changes; the round-4 corrections and the final main
synchronization each move it again. The control is re-run, and a fresh digest
recorded below, on the final stationary head — which is the only digest that
binds to what merges.

One incidental observation, recorded because it bears on how much this control
proves: the validator is a `PreToolUse` hook keyed on the tool call's command
string. When `git commit` was issued as one line of a multi-line shell
invocation with its output redirected, the hook did not fire and the corrupted
bundle committed cleanly; issued as its own command it blocked as shown above.
The commit was immediately reset and the bundle restored byte-exact (digest
above). This is a property of the local hook, not of anything this lane changes,
and it is reported rather than repaired here because repairing it is outside the
declared file scope.

### Re-verification on the synchronized head

```text
$ pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts
# tests 52
# pass 52
# fail 0

$ pnpm test:ops
# tests 2705
# suites 20
# pass 2705
# fail 0
# skipped 0

$ python3 .out/mutation/battery.py   # 39 semantic mutations
baseline 52 pass, 0 fail surviving 0 restored 52 pass, 0 fail count 39

$ pnpm verify:static
ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
ops:automation-coverage-check, env:check, lint, type-check, build,
pnpm test, smart-form verify, verify:commands
[executable-wiring] verdict=PASS required_roots=verify
[command-manifest] Verified 14 command definition(s)
[lint-migrations] 6 migration file(s) checked — no findings.
EXIT=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff
```

`pnpm verify` is `verify:static && test:live-db`; the live-DB half still refuses
locally under production containment, exactly as recorded above, and its receipt
is produced by CI's `staging-ci` environment inside the required `verify` job.

### Proof re-anchor

**Final binding: `verified_source_sha` = `f616d5cb`.** `sha_binding.merge_sha`
is `null`, as the shared schema-v2 evidence contract requires before a merge
exists (CEP-E7).

The binding history is preserved in `sha_binding.verified_source_sha_history`:
`daad7b00` (original bundle) → `149b60ee` (first main sync) → `f616d5cb`
(final substantive head).

**The `149b60ee` anchor became stale and its note was false.** It read "every
later commit touches proof artifacts only." The seventh adversarial review
measured that claim and it failed by a wide margin: at `149b60ee` the audit is
**1,105 lines with 4 tests**, while the tree the bundle describes has **2,120
lines and 52 tests**. The entire P1-A/P1-B hardening — rounds 8, 9 and 10 —
landed *after* that anchor. A PM approving the bundle in that state would have
been approving code no SHA on the branch contained. The claim is retracted here
rather than quietly overwritten.

`f616d5cb` is the last commit on this branch authoring a change to any non-proof
file. The single commit after it, `87f93bf6`, is the sanctioned synchronization
with `origin/main` `d847fbae`:

```text
$ git diff --name-status f616d5cb 87f93bf6
M	docs/06_status/readiness/readiness-score.json
```

That is an upstream `[skip ci]` bot ledger refresh this lane did not author. The
audit script, its test file, and all three proof artifacts are byte-identical
across the two commits, so every receipt in this bundle describes the tree at the
bound SHA. No production count, finding, or verdict was altered.

### Product truth is unchanged

The lane verdict stands as originally measured: **the historical production pick
population cannot support a trustworthy-pick claim.** Of 107,858 picks, exactly
1 is simultaneously non-fixture, fully identity- and provenance-complete, and
settled. Nothing in this synchronization softens that.
