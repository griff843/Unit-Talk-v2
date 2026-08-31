# PROOF: UTV2-1745

MERGE_SHA: 3a99f5043e950b6f5610b26aab4d761bc8fc46fb

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
      Forty-two independent, **semantic** mutations each turn at least one
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
      under containment. Round 11 narrows this: the shipped factories
      `createClosingOfferLookup` and `createMarketUniverseClosingLookup` were
      driven against a recording client and their emitted PostgREST criteria
      compared predicate-for-predicate with the SQL actually executed against
      production (`.out/replay/parity_receipt.json`), so the query *construction* is now
      proven rather than fixture-asserted. What is still unexecuted is the CLI
      entrypoint end to end under a real read key. Stated as a limitation, not
      closed.
- [x] Round 11 (eighth adversarial review): the round-10 battery mutated helper
      *bodies* but never the *call sites* that invoke them, so deleting the
      `asProductionClosingLine` wrapper at either tier, or reintroducing a trim
      at `buildGradingClvContext`'s `eventStartTime`, left every test green.
      Three call-site regression tests added; the three matching mutations now
      die.
- [x] `pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts` — 55 pass,
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
ok 53 - call site: the pinnacle-tier closing line passes through asProductionClosingLine
ok 54 - call site: the consensus-tier closing line passes through asProductionClosingLine
ok 55 - call site: buildGradingClvContext passes starts_at to the cutoff untrimmed
1..55
# tests 55
# suites 0
# pass 55
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 584.746056
```

### Mutation controls — each correction is load-bearing

> **Harness note.** The mutation harness was rebuilt on 2026-08-30 after the
> system reaped `/tmp`, destroying the battery scripts and their result files
> mid-sequence. The mutations were reconstructed from source and the harness now
> lives at `.out/mutation/battery.py` (gitignored, inside the repo) so a `/tmp`
> reap cannot break the evidence chain again. The reconstruction is recorded
> because it is weaker evidence than a continuously-maintained battery: its
> first run left ONE survivor, `read_only reverted to asserted literals`, and
> the fault was the reconstruction's — it patched the untested CLI wiring site
> instead of the `read_only` block in the report builder that the test actually
> covers. Repointed at the covered site, it dies.
>
> **Round 11 raised the battery from 39 to 42.** The eighth adversarial review
> found that the round-10 mutations targeted helper *bodies*
> (`asProductionClosingLine`, the untrimmed `starts_at` passthrough) but never
> the *call sites* that invoke them, so deleting a wrapper at its call site left
> the whole suite green. Three call-site mutations were added and three tests
> written to kill them. The table below is a single end-to-end re-execution of
> all 42 on the merged head `c4715923` against the 55-test baseline
> (receipt: `.out/mutation/mutations.json`). Every row is a direct measurement,
> not a restatement of the earlier 52-test run — three rows moved by more than
> the test-count delta (`snapshot_at closing cutoff dropped` went from 4 fail to
> 5, because the new pinnacle call-site test also depends on the cutoff). No
> mutation changed from dead to alive or the reverse.


Every mutation below was applied to `scripts/ops/pick-truth-audit.ts` in
isolation, the suite re-run, and the file restored byte-exact. A control that
cannot fail proves nothing, so each is shown failing.

```text
mutation                                                                       result
-----------------------------------------------------------------------------------------------
(none — corrected implementation)                                              55 pass, 0 fail
identity check removed from the grade ladder                                   47 pass, 8 fail
game_result event match dropped                                                52 pass, 3 fail
game_result participant match dropped                                          53 pass, 2 fail
game_result market match dropped                                               54 pass, 1 fail
event-scoped drift guard removed                                               54 pass, 1 fail
market identity conflict detection removed                                     52 pass, 3 fail
provenance re-admitted as an identity seed (self-validating market claim)      54 pass, 1 fail
reverse alias ownership check removed (foreign provider key may seed)          54 pass, 1 fail
grading CLV context ignored (event identity reconstructed instead)             54 pass, 1 fail
name-based participant fallback dropped                                        53 pass, 2 fail
closing table reverted to provider_offers                                      53 pass, 2 fail
snapshot_at closing cutoff dropped                                             50 pass, 5 fail
retained pick-side cutoff ignored (event-derived cutoff used instead)          54 pass, 1 fail
pinnacle bookmaker preference pass dropped                                     53 pass, 2 fail
market_universe participant semantics reverted to truthiness                   54 pass, 1 fail
odds gate over-tightened with `|| pick.odds === 0`                             54 pass, 1 fail
zero closing odds priced (caller falsy-check semantics ignored)                54 pass, 1 fail
null participant bail re-introduced (query production issues is refused)       53 pass, 2 fail
truncated page accepted instead of refused (exact-count guard removed)         54 pass, 1 fail
missing exact count treated as complete                                        54 pass, 1 fail
grading context null participant re-admits the metadata resolver (`??`)        54 pass, 1 fail
unresolvable grading context falls back to a weaker resolver                   54 pass, 1 fail
offer-lookup event id taken from market_universe first                         54 pass, 1 fail
participant precedence reverted to market_universe first                       54 pass, 1 fail
ambiguous external_id resolves to one of the events                            54 pass, 1 fail
selection side branch order collapsed into two families                        54 pass, 1 fail
moneyline structural classification reverted to eventScoped                    54 pass, 1 fail
superseded-correction check removed                                            54 pass, 1 fail
alias priority ordering removed (last-wins Map)                                54 pass, 1 fail
read_only reverted to asserted literals                                        54 pass, 1 fail
participants name-fallback pager reverted to a rows.length terminator          54 pass, 1 fail
participants name-fallback exact-count requirement removed                     54 pass, 1 fail
forward alias completeness assertion removed                                   54 pass, 1 fail
reverse alias completeness assertion removed                                   54 pass, 1 fail
name-fallback pool key reverted to a bare normalized name (all sports pooled)  54 pass, 1 fail
name-fallback LOOKUP ignores the pick sport                                    53 pass, 2 fail
sport pools collapsed to a single all-players pool when any pick lacks sport   54 pass, 1 fail
production closing-line validity gate removed (asClosingLineLike unmirrored)   52 pass, 3 fail
starts_at trimmed, diverging from production's untrimmed passthrough           53 pass, 2 fail
call site: tier-1 pinnacle asProductionClosingLine wrapper removed             54 pass, 1 fail
call site: tier-2 consensus asProductionClosingLine wrapper removed            54 pass, 1 fail
call site: trim reintroduced at buildGradingClvContext eventStartTime          54 pass, 1 fail
(restored byte-exact)                                                          55 pass, 0 fail
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

$ pnpm exec tsx scripts/ci/r-level-check.ts --base 249da64b --head c4715923
Verdict: PASS
Changed files: 10
Rules matched: (none) — no R-level artifacts required for this diff
```

> Endpoints are pinned to literal SHAs rather than `origin/main --head HEAD`,
> for the reason given under the git receipts below: a moving ref makes the
> printed `Changed files` count drift as main advances, which would falsify a
> receipt this bundle asserts. The verdict — the part that gates — is `PASS`
> either way; only the file count moves. Re-executed against the pinned
> endpoints while assembling round 12.

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
CLV outcome below is affected. What *that* round-10 replay did not prove was the
shipped query's own construction — its limit, order clause and emitted filter
strings. **Round 11 closes that gap**: `.out/replay/parity.ts` drives the
shipped `createClosingOfferLookup` and `createMarketUniverseClosingLookup`
against a recording client, and the emitted criteria
(`.out/replay/parity_receipt.json`) match the SQL actually executed against
production filter for filter — predicate-for-predicate, not byte-for-byte, since
one side speaks PostgREST and the other SQL. The construction is now captured
from the shipped code, not only unit-asserted. The two counts in the closing-line block
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
>    `missing_closing_line` (**100**) — a figure that is **itself now
>    superseded** by the round-11 replay, which shows the dominant cause was an
>    under-scoped `market_universe` fallback in the round-10 replay harness, not
>    production behaviour. See "CLV — superseded measurements" below.

Each of these revisions replaced a mis-causation with the behaviour production
actually has, and revision 4 (round 11) does the same to revision 3. The
direction of travel is one-way in the sense that no correction has been
reversed; it is **not** a claim that the CLV figures converged early. Every CLV
number above this line is withdrawn. The authoritative CLV measurement is the
round-11 replay, below.

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

### CLV — superseded measurements, and the round-11 replay

> **SUPERSEDED — do not cite.** Every CLV number in revisions 1–4 of this
> bundle is withdrawn, including the figures this section previously carried:
> `resolvable = 98`, `unresolvable = 102`, `missing_closing_line = 100`,
> `resolvability rate = 49.00%`, the `persisted clvStatus='computed' but
> currently unresolvable = 82` figure, the old→corrected transition table, and
> the "clean split" claim that **all 100 April settlements are
> CLV-unresolvable**. That last claim is false. It is removed rather than
> restated, and nothing in this bundle depends on it.
>
> Cause of the error, mechanically established. The round-10 replay was driven
> by a hand-assembled `dataset.json` that (a) resolved production's
> `market_universe` fallback against only the 100 rows reachable from
> `picks.metadata.marketUniverseId`, instead of the whole table, and (b) pruned
> load-bearing JSON columns — `events.metadata` reduced to `starts_at`,
> `settlements.payload` stripped of its `clv` block, and **three**
> `picks.metadata` objects emptied entirely —
> `01a77b3f-462d-4daa-b0ef-0b96ca120c15`,
> `9c8833ff-6738-4bf7-8874-257c5ef6cdfd` and
> `aec0db94-7ff9-42f4-8951-e39343f3f58c`. An earlier draft of this paragraph
> said "one"; the ninth review (P2-b) counted the retained `dataset.json`
> against the unpruned `fresh_tables.json` and measured three. The corrected
> count is used here and the understated one is withdrawn. Both defects were in that ad-hoc harness, **not** in
> `scripts/ops/pick-truth-audit.ts`. The shipped entrypoint
> (`runPickTruthAudit`, :2088) already passes
> `createMarketUniverseClosingLookup(client)` (:2102), which queries the full
> `market_universe` table, and `loadAuditDataset` already selects `payload`
> and `metadata` unpruned (:1671, :1697, :1760). No audit-logic change was
> required to obtain the corrected numbers, and none was made.
> `dataset.json` is retained only as superseded historical evidence and is not
> quantitative authority for anything.

**Definition — "CLV resolvable".** A settlement is counted resolvable when the
audit reaches a non-null closing line by the same ladder production uses and a
priced side exists for the pick's selection. It asserts nothing further. It does
**not** mean the pick was correctly graded, that the line is temporally valid,
that its provenance is trustworthy, or that the pick is traceable. Those are
measured separately below, and two of them fail.

**The resolution ladder has four rungs**, in the order production applies them:

```text
1  market_universe by id     picks.metadata.marketUniverseId -> closing_line
                             (production returns `computed` immediately;
                              NO cutoff is applied on this rung)
2  provider_offer_history    bookmaker_key = pinnacle, snapshot_at <= cutoff
3  provider_offer_history    no bookmaker filter,      snapshot_at <= cutoff
4  market_universe by key    eq provider_event_id + provider_market_key,
                             closing_line not null, limit 1
                             (production applies NO time filter on this rung)
```

Mechanism parity for rungs 2–4 is not asserted; it is captured. Driving the
**shipped** factories `createClosingOfferLookup` and
`createMarketUniverseClosingLookup` against a recording client emits the
criteria in `.out/replay/parity_receipt.json`: `eq.` on event and market,
`eq.`/`is.null` on participant, `lte.<cutoff>` plus
`order=snapshot_at.desc&limit=1` for rungs 2–3, and
`closing_line=not.is.null&limit=1` with **no** time predicate for rung 4.

The comparison is **predicate-for-predicate, not byte-for-byte**, and the
distinction is stated rather than glossed: the shipped path speaks PostgREST
while the replay spoke SQL through the MCP read channel, so the two are not
literally the same string. What is established is that every filter, its
operator, its null semantics, its ordering and its limit correspond one to one,
and that no predicate present on one side is absent on the other.

#### Cohort identity — reproducible digests and the exact 200 rows

The cohort is fixed and stated in full, so a reviewer can confirm that round 11
measured the same 200 rows as rounds 1–10 and that the movement in the CLV
numbers is attributable to the fallback scoping alone, not to a different
sample.

**Digest definition.** `sha256` over the ids joined by a single `,` with no
trailing separator, in the cohort's canonical order: the 100 earliest by
`settled_at` ascending, then the 100 latest by `settled_at` descending.

```text
settlement-id digest  41edbf1b3ab8a1c2074e22e3613c357d36009468971dda8928b823336f96244e
pick-id digest        f2f7f039e61137adbd8614046c438a115bdc97afa05b2e0cfde394b8ef868c53
count                 200 settlements, 200 distinct pick ids
```

Reproduce:

```bash
python3 -c "import json,hashlib;c=json.load(open('.out/replay/cohort11.json'));\
print(hashlib.sha256(','.join(c['settlement_ids']).encode()).hexdigest());\
print(hashlib.sha256(','.join(c['pick_ids']).encode()).hexdigest())"
```

The superseded round-10 `dataset.json` reproduces the settlement digest in
exact order. That is what establishes cohort continuity across the correction.

The full ordered lists are carried in
`evidence.json` → `post_fix_validation.cohort_identity.settlement_ids` and
`.pick_ids`, and the per-row resolution outcome for each is in
`.out/replay/per_row11_final.json`. The first and last five of each, as a
spot-check anchor:

```text
settlement_ids[0..4]    980e9f90-e526-4c22-b307-97b1daa7f773
                        4a4b918a-ede2-4ea8-9ac7-9f6bb0f87a81
                        3237cc49-57d5-4178-9bf3-47953a682adf
                        cafeaf39-eafa-47fe-93c9-d9eaf48bab06
                        be81aba5-3541-4d69-9781-e4cab7aa989c
settlement_ids[195..199]931ed7ce-510a-44c5-8242-76082e221d85
                        c667d2b7-f93c-418d-bf98-4979dedfa2d8
                        8d86a1e1-b366-4117-8274-e383324e29e6
                        c7bf579f-2fa6-481f-b865-10d72093401a
                        78d0dd8d-6757-4f56-b35d-7103a7121d33
pick_ids[0..4]          b6764d3c-bafe-439f-9770-4932ec5253d8
                        1b762490-5e8c-4edf-9a39-7212692576a9
                        ede52e01-f7ee-4df5-bd02-f5a77cf58977
                        46fdac6b-8ec6-4311-af71-b7f422858975
                        ce407160-9022-4ff6-afe8-d7bc4d98cf61
pick_ids[195..199]      e981c7c9-b91e-43bf-bbec-ad7f75c6479b
                        66d46240-e919-4b3b-b8a0-424a7512095f
                        bd8a0d73-131d-401a-b699-08608f1a1555
                        f187a0a5-a0d4-4f2c-acdc-49cd8a9c303a
                        5dc821fb-a8b0-4830-891d-9ef0d43d474a
```

#### Executed query receipts

Every statement below is a `SELECT`, issued through the Supabase MCP read path
against production `zfzdnfwdarxucxtaojxm` on 2026-08-30. **Writes performed: 0.**
The full statements and their results are carried in `evidence.json` →
`runtime_proof.queries` (Q1–Q8).

```text
id  purpose                                                        rows
--  -------------------------------------------------------------  ------------
Q1  exact table cardinalities                                      6 counts
      picks 107858 · events 789 · provider_offer_history 14456685
      settlement_records 37496 · game_results 135249 · participants 1647
Q2  the 200-settlement cohort in canonical order                       200
Q3  every row the shipped loader reads, JSON columns UNPRUNED
      settlement_records 200 · picks 200 · game_results 192
      events 42 · participants 132 · market_universe 100
Q4  provider_market_aliases, both directions               fwd 30 · rev 19
Q5  participant name-fallback pool, exact-count paged                 1523
Q6  per (event, market) snapshot_at min/max, to bound the
    14.4M-row offer table                                             480
      -> 186 triples needed, 92 provably empty, 94 alive
Q7  rung 2/3: latest pre-cutoff offer per alive triple                 111
      94 alive triples x 2 provider tiers (pinnacle, then ANY)
      = 188 probes. Issued as ONE 188-way query it timed out --
      the only usable index is (provider_event_id, snapshot_at)
      -- so it was re-issued as 4 batches of at most 24 triples,
      each batch covering both tiers. 111 of the 188 probes
      returned at least one row (17 pinnacle, 94 ANY); the
      other 77 returned none. Those 111 results are retained
      verbatim in .out/replay/offer_rows11.json and hold
      1,221 offer rows in total.
Q8  rung 4: market_universe fallback over the WHOLE table               90
      market_universe holds 102,155 rows; the round-10 replay
      resolved this rung against 100 of them. That single
      scoping defect accounts for the entire 98 -> 194 movement.
Q9  market_universe cardinality, executed to substantiate
    the 102,155 denominator Q8 depends on                            1 row
      total_rows 102155 · with closing_line 88213
      · without closing_line 13942
```

> **The three numeric claims in Q7 that the ninth review found mutually
> inconsistent are corrected above from the retained receipts.** The earlier
> text compressed "4 batches of at most 24 triples, both tiers" into "4 batches
> of 24 probes", which cannot reconcile with either 188 or 94. The batching
> unit is the *triple*; the probe count is twice that. Counted from
> `offer_rows11.json`: 94 distinct triples, 111 non-empty probe results,
> 17 of them at the pinnacle tier and 94 at ANY.

**Q9 receipt, in full.** The ninth review (P2-c) found that 102,155 — the
denominator carrying the entire round-10-vs-round-11 CLV explanation — was
asserted with no executed receipt behind it. It now has one.

```text
query        SELECT count(*) AS total_rows,
                    count(*) FILTER (WHERE closing_line IS NOT NULL)
                      AS rows_with_closing_line,
                    count(*) FILTER (WHERE closing_line IS NULL)
                      AS rows_without_closing_line,
                    now() AS executed_at
             FROM public.market_universe;
channel      Supabase MCP execute_sql (read-only SELECT)
project_ref  zfzdnfwdarxucxtaojxm  (production)
environment  production read path; no credential is stored in, or
             recoverable from, this bundle
executed_at  2026-08-30 23:49:36.002252+00   (server clock, returned by the
                                              statement itself)
result       total_rows                 102155
             rows_with_closing_line      88213
             rows_without_closing_line   13942
             102155 = 88213 + 13942                       (reconciles)
writes       0
```

The six id-sets Q3 returns were independently re-derived and matched the
round-10 sets exactly. That is what allows the round-10 `dataset.json` to be
identified as *pruned* rather than *differently scoped*, and it is why the CLV
movement is attributable to Q8 alone.

#### How the per-row artifact is produced — a retained, re-runnable script

The ninth adversarial review (P2-d) found that **no retained script produced the
artifact every published count is read from.** `attribute.ts` wrote
`per_row11.json`, which reports `resolution_source: 'none'` for all six rung-1
rows and carries neither `source_exact` nor `cutoff_enforced` — the two fields
the entire 194 / 150 / 44 / 40 / 4 analysis rests on. Those fields had been
derived by manual steps that were never written down. A reviewer could not
reproduce the numbers. That gap is closed.

`.out/replay/derive_final.ts` now produces `per_row11_final.json`
deterministically from retained inputs alone:

```text
$ pnpm exec tsx .out/replay/derive_final.ts
rows: 200
partition  r1 by-id 4 · r1 priced-side-only 2 · r2 pinnacle 17 · r3 consensus 77
           · r4 universe 96 + 1 · none 3                       = 200
resolvable 194   cutoff_enforced 150   NOT cutoff-validated 44
             = r4 post-cutoff 40 + r1 no cutoff 4
grade unresolvable 100   structural 100
post-cutoff watermarks: ["2026-04-24T00:00:00+00:00"]
cohort settlement digest: 41edbf1b3ab8a1c2074e22e3613c357d36009468971dda8928b823336f96244e
per_row11_final.json sha256: d306a84e...
```

Three properties make it evidence rather than restatement:

- **It imports the shipped code.** `buildPickTruthAuditReport`,
  `selectLatestClosingOffer` and `asProductionClosingLine` are imported from
  `scripts/ops/pick-truth-audit.ts` and executed, not re-implemented. It reads
  that module; it cannot modify it, and no shipped audit logic changed in
  round 12.
- **It distinguishes rung 1 from rung 4, which `attribute.ts` did not.** Rung 1
  is identified as the case where *no lookup fired at all* — precisely what the
  by-id short-circuit at `pick-truth-audit.ts:1276` does, returning before any
  cutoff is derived. Rung 4 is the late `market_universe` lookup keyed on
  provider identity. Conflating them would have understated the
  no-cutoff-applied population.
- **A rung wins only if its row survives `asProductionClosingLine`.** A row that
  fails that gate makes production skip the whole *tier*, not fall through to
  the second-latest row inside it. `attribute.ts` did not mirror this, which is
  a latent misattribution the review's finding exposed.

Re-deriving changed exactly **6 of 200 rows**, and only in the coarse
`resolution_source` label: the six rung-1 rows read `'none'` before and
`'market_universe:closing_line'` now. `source_exact`, `cutoff_enforced`,
`clv_resolvable`, `clv_failure_class`, `grade_resolvable` and
`structural_blocked` are identical on all 200 rows. **No published number
changed.**

`replay11.ts` previously read the cohort order from a `/tmp` scratch file — the
same class of undocumented manual input. It now reads
`.out/replay/cohort11.json`. Re-running it reproduces `report11.json`
**byte-identically** — `generated_at` is a pinned literal, not a clock read — so
the digest below is a reproducible check, not a one-time snapshot. Every digest
in the table below was re-verified after re-executing both scripts from a clean
invocation; all sixteen matched.

**Retained inputs and outputs, with digests** (`.out/` is gitignored; these
digests are what binds the published numbers to specific bytes):

```text
cohort11.json            6041a861de23e0d0cd5fd4fe33772eb718b79385289590075022c831b664c24c
fresh_tables.json        389f5afd9cbe946cd16aa4a6ae0fd65354300aa181e38ea1f172dca19ac26ad4
player_pool_all.json     33d3c6f1aa2ce597f6b2357f27861896498d5b8759941f4b67751765559520f6
fwd_aliases11.json       df46a50c6c17799b41508c3d441932dc314890710a4a04f3c0addd08a8da1bbc
rev_aliases11.json       dafa75135a8d163e06b696b9ed85119d4d0b3dd245f7e52fbd1557a4ab8660a3
offer_rows11.json        227f3b9848929fcd8cca353d29628b2743824ea9152c691d63b6e543a0cd8c34
universe_rows11.json     735e46a704781bd77e2678b092340483de72c32135a72e4439785b40ea43d372
row_counts11.json        1290d62e1e30f1a6bef44bea220658f0d3b597282605e4eaeb8a06e99334e376
em_ranges.json           84081bbe4337b3c6700c0a4387425244494f0050af3c663b49d630a1e83263f5
parity_receipt.json      ea94c041583dc054ef97dd300be22dc4e896728b194e5cae010da824b9cfd289
per_row11_final.json     d306a84ea0bbbb8c60f106a0030adb9609c2b05722633e9afcb3386653cfd49a
report11.json            8cc3adf1d431a638f8c5e8b359efd422cbf7602000af19ebd6453acfe30c410b
derive_final.ts          50e4586c8d825a274bbe72f398429767f9d12094b931a6655acd32f3a6de5f69
replay11.ts              6b4b2497fa42c1ac3a743f32ab8684c5a2e3aa3888f15de611de5c5c2ba3a940
parity.ts                473ac5eeafa26161c0cf3babc2c13c38975836dba60783da82e345d9c6507724
attribute.ts             53803e9ae9fdb073e532a18426c93b5ad27a0cbcb47e2d65ed88e2b043f1eff0
mutation/mutations.json  3f564ab2b0c336168b7e1316e3c8f97cddb4245a793195fee7f071b60431bdae
mutation/battery.py      24d929a9c93a9fb176b9b29ba3356e78665a82af34804a5234ead89e88613152
```

#### Every one of the 200 accounted for

```text
resolution source                            outcome                       n
market_universe: by-id short-circuit (r1)    resolvable                    4
market_universe: by-id short-circuit (r1)    unresolvable missing_priced_side  2
provider_offer_history: pinnacle (r2)        resolvable                   17
provider_offer_history: consensus (r3)       resolvable                   77
market_universe: provider-key lookup (r4)    resolvable                   96
market_universe: provider-key lookup (r4)    unresolvable missing_priced_side  1
no line on any rung                          unresolvable missing_closing_line 3
                                                                       -----
                                             TOTAL                       200
```

CLV resolvable **194**, unresolvable **6** (3 `missing_closing_line`,
3 `missing_priced_side`). The partition sums to 200 by construction: it is
derived by replaying each settlement individually
(`.out/replay/attribute.ts`, 200 runs), and its totals reconcile exactly with
the independent whole-cohort run: 194 resolvable both ways, 100 grading-
unresolvable both ways, 100 structurally blocked both ways.

#### Why the April half resolves, and why that is not reassuring

`provider_offer_history` retains no snapshot earlier than **2026-06-25** for
these events, so every offer criterion issued for the April half — 200 of them,
100 picks across rungs 2 and 3 — correctly returns zero rows. The April picks
resolve on rung 4, because `market_universe`
retains a `closing_line` after the underlying history has aged out. The prior
bundle mistook the retention gap for an absence of closing lines outright.

But rung 4 applies **no cutoff**, and rung 1 applies none either. Testing every
resolved row against its own permitted cutoff:

```text
resolvable                                              194
  cutoff-enforced (line snapshot <= cutoff)             150
  NOT cutoff-validated                                   44
    rung 4, snapshot strictly AFTER the cutoff           40
    rung 1, no cutoff applied at all                      4
```

**What "snapshot" means on rung 4, stated rather than assumed.** Rungs 2 and 3
read `provider_offer_history.snapshot_at`, which is the real capture time of the
priced row. Rung 4 reads `market_universe`, which has no `snapshot_at`; the only
temporal field on the row is **`market_universe.last_offer_snapshot_at`**, and
that is the column used as the cutoff proxy for all 40 rows below. It is a
*proxy*, not the same measurement: it records when the universe row last saw an
offer, not when the line it stores was priced. The ninth review (P3) was right
that leaving it unnamed hid a load-bearing assumption. Naming it makes the
weaker inference explicit — and the inference still holds in the only direction
this bundle uses it, because a `last_offer_snapshot_at` *after* the cutoff
proves the row was still being written after the cutoff, which is sufficient to
deny that it is a cutoff-valid closing line. The converse (proxy at or before
cutoff ⇒ genuinely cutoff-valid) is **not** claimed anywhere.

All **40** post-cutoff rows carry the identical `last_offer_snapshot_at`
`2026-04-24T00:00:00+00:00` — one uniform midnight watermark across 40 distinct
markets, which is a batch backfill, not 40 per-market closing captures. A line
stamped after the event's own cutoff cannot be the closing line as of that
cutoff. This is production-parity behaviour, so it is a defect in production's
CLV provenance, not an audit artifact — and it is why "resolvable" is defined
above to carry no claim of temporal validity.

### The shipped `systemic_defect` detector flipped true → false

**This is disclosed prominently because it moved, in this lane, as a direct
consequence of the round-11 CLV correction — and because a reviewer would
otherwise have to find it in a gitignored replay receipt.**

```text
round 10   systemic_defect { detected: true,
                             reasons: ["CLV unresolvable rate 51% is at
                                        least the 10% materiality rule"] }
round 11   systemic_defect { detected: false, reasons: [] }
```

The detector implements exactly two threshold rules: grading disagreement at or
above 5% of independently resolvable grades, and CLV unresolvable at or above
10% of sampled grading settlements. The grading rule has measured zero in every
round — no sampled pick produced an event, participant or market *mismatch*,
because the failure mode here is **absent** pick-side identity, not contradicted
identity. The CLV rule fired in round 10 at 51%. The corrected measurement is
**6 / 200 = 3%**, below its threshold. Both rules are therefore below threshold
and the detector reports nothing.

**What that does not mean.** `systemic_defect: false` means only that neither
*currently implemented* rule fired. It does not mean this cohort is trustworthy,
and it is not evidence that it is. The detector has no rule for grading
**unverifiability** and no rule for **structural blockers** — which are exactly
the two conditions carrying this lane's verdict, at 50% of the cohort each.

**The verdict does not depend on the detector and did not move with it.**
`can_currently_produce_trustworthy_pick` is produced by the shipped verdict
logic, is `false` in both rounds, and records its own reasons, verbatim from
`.out/replay/report11.json`:

```text
"100 sampled grades cannot be independently resolved"
"6 sampled picks cannot currently resolve CLV"
"100 sampled picks have structural blockers"
```

**No rule was hand-authored to compensate.** The materiality table in the next
section is proof narrative for a human reader. It is explicitly *not* a rule the tool
applies, it does not extend or redefine the detector, and no "load-bearing
materiality rule" was added to `pick-truth-audit.ts` in round 11 or round 12.
The audit script is byte-identical to its state at `3a99f504`.

**Recorded as a proposed successor issue, deliberately not done here.**
Expanding `systemic_defect` to score grading unverifiability and/or structural
blockers would be substantive audit logic, out of scope for a proof-only
remediation round and out of scope for UTV2-1745, whose acceptance criteria
never mention the field. It is written down so it is not lost: on the corrected
measurement the CLV arm of the governing issue's stop condition ("a systemic
grading or CLV defect affecting a material share of picks") no longer trips,
while 100 of 200 sampled picks cannot have their grade independently verified —
plausibly a systemic grading defect affecting a material share, which no
implemented rule detects. That gap is the successor's subject.

### Effect on the lane verdict

The verdict is **unchanged**: `can_currently_produce_trustworthy_pick: false`.
CLV unavailability is **not** the basis for it, and the previous
"CLV unresolvable rate 51.00%" materiality framing is withdrawn — its numerator
no longer exists. The verdict rests on the defects that survive the corrected
measurement, each with an explicit numerator and denominator over the 200-row
cohort:

```text
metric                                     numerator / denominator        rate
grading identity independently unverifiable      100 / 200             50.00%
structurally blocked picks                       100 / 200             50.00%
CLV resolved without cutoff-valid provenance      44 / 194             22.68%
CLV technically resolvable                       194 / 200             97.00%
CLV resolvable AND cutoff-valid                  150 / 200             75.00%
```

The first two are the load-bearing ones. Half the cohort cannot have its grade
independently verified at all: the only event identity available for those 100
rows is `gameResult.event_id`, the very row under validation, so any agreement
there is circular. The same 100 rows are structurally blocked (99 orphaned
event, 4 missing participant, 4 unresolvable market; the classes overlap). A
pipeline that cannot independently verify half its settled grades does not
support a trustworthy-pick claim, whatever the CLV column says — and the CLV
column, read honestly, adds a third defect rather than an exoneration: 44 of the
194 resolutions rest on a line that was never shown to precede its cutoff.

The 2026-08-26 population decomposition (1 of 107,858 picks simultaneously
non-fixture, identity- and provenance-complete, and settled) is untouched by
this correction and is not restated here.

## Round-12 remediation — disposition of every ninth-review finding

The ninth independent adversarial review returned CHANGES_REQUIRED with nine
findings. **All nine are dispositioned below, including the three that were not
in the summary returned to PM.** Every repair is proof-only: no shipped audit
logic, package behaviour or production execution semantic was touched, and
`scripts/ops/pick-truth-audit.ts` remains byte-identical to its state at
`3a99f504`.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | Shipped `systemic_defect` flipped `true` → `false` between rounds 10 and 11, undisclosed | **Fixed — disclosed.** New section "The shipped `systemic_defect` detector flipped true → false" gives both rounds' verbatim output, the cause of each, why the verdict is independent and unchanged, what the flag does *not* mean, and the detector-expansion successor. No rule was hand-authored to compensate. |
| 2 | P1 | Withdrawn "persisted `computed` but unresolvable = 82" had a measured successor (16 mismatches) that was never reported | **Fixed — reported.** New Finding 7: 16 / 200 = 8.00%, split 13 / 2 / 1, bound to `report11.json` → `clv.persisted_status_mismatches`, where each entry carries `settlement_id`, `pick_id` and reason. |
| 3 | P2 | `git diff --name-status 3a99f504 HEAD` asserted a fixed one-path result, which committing that assertion falsified | **Fixed — endpoints pinned.** Every comparison now uses two immutable SHAs (`3a99f504`/`c4715923`/`b10d8aa8`/`249da64b`) and was re-executed against them. The one leg that cannot be pinned is stated as a property for the reviewer to verify, not as asserted output. |
| 4 | P2 | Round-10 harness described as emptying "one" `picks.metadata`; the real count is three | **Fixed — corrected to three,** with all three ids listed. Independently re-measured against `fresh_tables.json`: exactly three, and all three had real metadata upstream. |
| 5 | P2 | The 102,155 `market_universe` denominator had no executed query receipt | **Fixed — receipt added** as Q9: statement, channel, project ref, environment, server-clock timestamp, all three counts, and the internal reconciliation `102155 = 88213 + 13942`. No credential appears in, or is recoverable from, this bundle. |
| 6 | P2 | No retained script produced `per_row11_final.json`; `source_exact` and `cutoff_enforced` came from undocumented manual steps | **Fixed — `derive_final.ts` retained.** Imports the shipped exports, reproduces the 194 / 150 / 44 / 40 / 4 analysis from retained inputs, separates rung 1 from rung 4, applies `asProductionClosingLine` at tier granularity. `replay11.ts` de-`/tmp`-ed. Outputs and digests recorded. |
| 7 | P3 | The rung-4 cutoff comparison used an unnamed proxy column | **Fixed — named.** `market_universe.last_offer_snapshot_at`, stated as a proxy, with the direction of inference it does and does not support made explicit. |
| 8 | P3 | Q7's probe accounting (4 × 24, 188, 94) was mutually inconsistent | **Fixed — recounted from `offer_rows11.json`.** The batching unit is the *triple*, not the probe: 94 alive triples × 2 tiers = 188 probes, one 188-way query timed out, re-issued as 4 batches of ≤24 triples covering both tiers, 111 non-empty results (17 pinnacle, 94 ANY), 1,221 offer rows. |
| 9 | P3 | `diff-summary.md` mixed the round-8/9 mutation count (34) with the current one (42) | **Fixed —** the two counts are now explicitly attributed to their rounds wherever both appear. |

Findings 1, 2, 3, 4, 5 and 6 were each independently verified against the
retained receipts before being accepted, rather than accepted on the reviewer's
assertion.

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

6. **The blocker is unverifiable grading identity, not closing-line
   availability.** An earlier revision of this finding claimed the sample
   "splits exactly in half by age", with all 100 April 2026 settlements both
   independently unverifiable *and* CLV-unresolvable. **That claim is
   withdrawn.** The round-11 replay resolves CLV for 96 of those 100 April
   rows. `provider_offer_history` retains nothing before 2026-06-25 for these
   events, but `market_universe` retains the closing line after the history
   ages out, and production's fallback reads it — so the retention gap was
   mistaken for an absence of data.

   What survives is a cleaner and narrower statement. CLV availability is
   **not** the lane's blocker: 194 of 200 resolve. The blocker is that 100 of
   200 settlements have no pick-side event identity, so the only identity
   available is `gameResult.event_id` — the row being validated — and any
   agreement on those rows is circular. The same 100 are structurally blocked.
   Independently, 44 of the 194 CLV resolutions rest on a line never shown to
   precede its own cutoff (40 carrying a single backfilled
   `2026-04-24T00:00:00+00:00` watermark, 4 taking a rung that applies no
   cutoff), so closing-line *availability* overstates closing-line
   *validity*. The remedy is making event identity a first-class field at
   admission (Finding 1) and giving the CLV fallback a cutoff predicate — not
   backfilling offer history.

7. **Production's persisted `clvStatus` disagrees with the corrected audit on
   16 of 200 sampled settlements (8.00%).** This is the measured successor to
   the withdrawn "persisted `computed` but currently unresolvable = 82", which
   was an artifact of the pruned round-10 dataset and is retired. The
   replacement is measured, not estimated, and is reported here rather than
   dropped with the figure it replaces:

   ```text
   currently resolvable, persisted missing_closing_line     13
   currently resolvable, persisted missing_priced_side       2
   persisted computed,  currently missing_priced_side        1
                                                        ------
                                                            16 / 200 = 8.00%
   ```

   Fifteen are cases where the audit resolves CLV but production recorded a
   failure; one is the reverse. Every entry carries its `settlement_id`,
   `pick_id` and reason in `.out/replay/report11.json` →
   `clv.persisted_status_mismatches`, so all sixteen are individually traceable
   to a cohort row. This is the resolver-disagreement signal the audit exists to
   surface, and it is independent of the cutoff-provenance defect in Finding 6.
   It is deliberately **not** added to the materiality table: that table is
   narrative framing, and adding a metric to it would not make it a rule the
   tool applies. Neither implemented `systemic_defect` rule scores this class.

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
$ git show --format="" 149b60ee --stat -- package.json
 package.json | 2 +-
$ git show --format="" 149b60ee      # combined diff: what the merge AUTHORED
diff --cc package.json
++    "test:ops": "... scripts/ops/outbox-triage.test.ts scripts/ops/pick-truth-audit.test.ts",
```

The combined diff of merge commit `149b60ee` contains exactly one file. Nothing
inherited from `main` was re-authored, and
`git diff 149b60ee 249da64b -- docs/06_status/proof/UTV2-1729/` is empty — the
closed historical bundle that originally blocked this merge is untouched. (Both
commands were originally written against `HEAD` and `origin/main`, which were
`149b60ee` and `249da64b` when they ran; they are pinned here so the receipt
survives the commits that came after it. Both were re-executed against the
pinned endpoints in round 12.)

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

Re-run on the merged head `c4715923`, not carried forward from an earlier tree.

```text
$ pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts
# tests 55
# pass 55
# fail 0

$ pnpm test:ops
# tests 2708
# suites 20
# pass 2708
# fail 0
# skipped 0

$ python3 .out/mutation/battery.py   # 42 semantic mutations
baseline 55 pass, 0 fail surviving 0 restored 55 pass, 0 fail count 42

$ pnpm verify:static
ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
ops:automation-coverage-check, env:check, lint, type-check, build,
pnpm test, smart-form verify, verify:commands
[executable-wiring] verdict=PASS required_roots=verify
[command-manifest] Verified 14 command definition(s)
[lint-migrations] 6 migration file(s) checked — no findings.
EXIT=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base 249da64b --head c4715923
Verdict: PASS
Changed files: 10
Rules matched: (none) — no R-level artifacts required for this diff
```

> Endpoints are pinned to literal SHAs rather than `origin/main --head HEAD`,
> for the reason given under the git receipts below: a moving ref makes the
> printed `Changed files` count drift as main advances, which would falsify a
> receipt this bundle asserts. The verdict — the part that gates — is `PASS`
> either way; only the file count moves. Re-executed against the pinned
> endpoints while assembling round 12.

`pnpm verify` is `verify:static && test:live-db`; the live-DB half still refuses
locally under production containment, exactly as recorded above, and its receipt
is produced by CI's `staging-ci` environment inside the required `verify` job.

### Synchronization with main — a recorded process deviation

The 2026-08-30 second synchronization did **not** route through
`pnpm ops:merge-wrapper git-merge-main`. That command cannot succeed on this
branch, and the failure is a defect in the wrapper, not in the branch.

```text
$ pnpm ops:merge-wrapper git-merge-main
fatal: Not possible to fast-forward, aborting.
```

`buildExtendedCommand` in `scripts/ops/ops-merge-wrapper.ts:88-108` emits
`git merge --ff-only origin/main` for the `git-merge-main` verb. A branch with
its own commits is by definition diverged from `origin/main`, so `--ff-only`
can never succeed, and the safe non-rebasing exit UTV2-1678 advertises is
unreachable for every lane that has committed anything. This is reported to the
**UTV2-1790** owner as cross-lane coordination; nothing in that worktree was
touched from this lane, and no second wrapper lane was opened.

The synchronization was therefore performed directly as
`git merge --no-ff --no-edit origin/main`, and the wrapper's own dropped-path
check was replicated by hand. **This is recorded as a process deviation, not a
precedent.** The branch was not rewritten and the synchronization was not
repeated to force it through the broken verb. The machine evidence admitting
`c4715923`:

```text
$ git rev-list --parents -n1 c4715923
c4715923…  3a99f504…  249da64b…          # p1 = lane head, p2 = origin/main

$ git merge-base --is-ancestor 3a99f504 HEAD && echo ANCESTOR_YES
ANCESTOR_YES                               # deliberately left on HEAD: this
                                           # claim STRENGTHENS as commits are
                                           # appended, it cannot be falsified
                                           # by publishing it, and if it ever
                                           # fails the 3a99f504 binding is void

$ git rev-parse c4715923^2
249da64b1108815f1bde07e82414535e64fe4382   # parent 2, pinned to the merge
                                           # itself rather than to the moving
                                           # origin/main ref

$ git merge-base --is-ancestor 249da64b c4715923 && echo CONTAINS_MAIN_AT_SYNC
CONTAINS_MAIN_AT_SYNC                      # permanently true; the moving-ref
                                           # form (origin/main...c4715923,
                                           # which read 0 behind / 14 ahead at
                                           # 2026-08-30T23:0Xz) is a timestamped
                                           # measurement, not a standing fact

$ git diff --name-status 3a99f504 c4715923  # what main contributed
M	docs/06_status/readiness/readiness-score.json

$ git diff --name-status c4715923 b10d8aa8  # round 11: proof-only
M	docs/06_status/proof/UTV2-1745/diff-summary.md
M	docs/06_status/proof/UTV2-1745/evidence.json
M	docs/06_status/proof/UTV2-1745/verification.md

$ git diff --name-status 249da64b c4715923  # what the lane contributes
A	.ops/sync/UTV2-1745.yml
A	docs/06_status/lanes/UTV2-1745.json
A	docs/06_status/proof/UTV2-1745/.gitkeep
A	docs/06_status/proof/UTV2-1745/diff-summary.md
A	docs/06_status/proof/UTV2-1745/evidence.json
A	docs/06_status/proof/UTV2-1745/model-routing.json
A	docs/06_status/proof/UTV2-1745/verification.md
M	package.json
A	scripts/ops/pick-truth-audit.test.ts
A	scripts/ops/pick-truth-audit.ts

$ comm -23 <(git ls-tree -r --name-only 3a99f504 | sort) \
           <(git ls-tree -r --name-only c4715923 | sort) | wc -l
0                                           # nothing dropped from the lane side

$ comm -23 <(git ls-tree -r --name-only 249da64b | sort) \
           <(git ls-tree -r --name-only c4715923 | sort) | wc -l
0                                           # nothing dropped from main's side
```

> **Why every endpoint above is a literal SHA and not `HEAD`.** The ninth
> adversarial review (P2-a) found that this block previously printed
> `git diff --name-status 3a99f504 HEAD`, asserting a one-path result — and
> that committing that very assertion moved `HEAD` and made the printed output
> wrong. A receipt whose act of publication falsifies it is not evidence. Every
> comparison is therefore pinned to two immutable commits, and each command
> above was **re-executed** against those pinned endpoints while assembling
> this round; the output shown is the output returned, not output assembled
> from expectation.
>
> The remaining leg — from `b10d8aa8` to whatever the final head turns out to
> be — cannot be printed here for the same reason, so it is stated as a
> property a reviewer verifies rather than as output this document asserts:
>
> ```text
> $ git log --format='%H %s' --name-only c4715923..HEAD
> ```
>
> Every commit that listing returns must touch only paths under
> `docs/06_status/proof/UTV2-1745/`. `b10d8aa8` (round 11) is shown above and
> satisfies it. The round-12 remediation commit is likewise proof-only by
> construction: it is the commit that carries this paragraph, and the same
> listing exhibits its contents. If any commit in that range touches
> `scripts/ops/`, `package.json`, or any path outside the proof directory, the
> `verified_source_sha = 3a99f504` binding is void and this bundle must be
> rejected.
>
> **The branch is behind main again, and that is disclosed rather than
> hidden.** `origin/main...c4715923` measured `0 behind / 14 ahead` at the
> moment of synchronization. Main has since advanced with further `[skip ci]`
> bot ledger refreshes, so a later invocation will report a non-zero
> left-hand count. That is expected drift on a long-lived T1 lane, it is not a
> defect in this bundle, and it is deliberately not "fixed" here: another
> synchronization merge would move the last non-proof commit and invalidate
> both the `3a99f504` anchor and every head-pinned governance artifact.

Read together: `3a99f504` is a first-parent ancestor of the merge; parent 2 is
`249da64b`, which was `origin/main`'s tip at the moment of synchronization; the
merged tree is main's tree at that point plus exactly the ten paths this lane
authors and nothing else; not one path from either side was dropped; the branch
was zero behind main at the sync commit; and the worktree was clean. The one path main contributed,
`readiness-score.json`, is an upstream `[skip ci]` bot ledger refresh this lane
did not author.

### Proof re-anchor

**Final binding: `verified_source_sha` = `3a99f504`.** `sha_binding.merge_sha`
is `null`, as the shared schema-v2 evidence contract requires before a merge
exists (CEP-E7).

`3a99f504` is the last commit on this branch authoring a change to any non-proof
file: the three round-11 call-site regression tests in
`scripts/ops/pick-truth-audit.test.ts`. The one commit after it, the
synchronization merge `c4715923`, contributes exactly one path from main
(`docs/06_status/readiness/readiness-score.json`, an upstream `[skip ci]` bot
ledger refresh this lane did not author) and nothing of its own —
`git diff --name-status 3a99f504 c4715923` lists that single file, and every
commit after `c4715923` is proof-only (see the receipt block above).
`scripts/ops/`
and all proof artifacts are byte-identical across the two commits, so every
receipt in this bundle describes the tree at the bound SHA.

**A gate that would flag this anchor, disclosed even though it does not run
here.** `scripts/ci/proof-binding-validator.ts` was executed against this bundle
during round 12 and returns FAIL with four violations. It is reported rather
than omitted, with the reason each is inapplicable stated plainly — a reviewer
should not have to discover this by running the tool themselves:

```text
$ pnpm exec tsx scripts/ci/proof-binding-validator.ts \
    --issue UTV2-1745 --proof-dir docs/06_status/proof/UTV2-1745
VIOLATIONS (4):
  MERGE_SHA must be "pending merge" before merge
  verification.md must contain exactly one "## Merge SHA Binding" section (found 0)
  model-routing.json: top-level merge_sha is forbidden before merge
  Non-proof files changed between verified_source_sha and HEAD:
    docs/06_status/readiness/readiness-score.json
proof-binding-validator: FAIL
```

- **It does not gate this PR.** The validator is invoked from exactly one
  workflow, `migration-reversibility-gate.yml`, which is path-filtered to
  `supabase/migrations/**`, `db/migrations-rollback/**`, three migration CI
  scripts and its own workflow file. This lane touches none of them —
  `git diff --name-only 249da64b c4715923` intersected with that filter is
  empty — so the workflow does not trigger and this check will not appear on the
  PR. That is a statement about *which* gates govern, not a claim that the tool
  is wrong.
- **The first three violations are a live disagreement between two validators,
  not a defect introduced here.** This validator wants `MERGE_SHA: pending
  merge`; required `Executor Result Validation` rejects a non-SHA in that field.
  The bundle satisfies the gate that actually runs. The `## Merge SHA Binding`
  section and the `model-routing.json` `merge_sha` key belong to that same
  older contract, which schema-v2's `sha_binding` block replaced (CEP-E7).
- **The fourth is inherited from `main`, not authored by this lane.**
  `readiness-score.json` entered the branch through the synchronization merge as
  main's own content; its last author is `github-actions[bot]`
  (`ops(readiness): refresh ledger [skip ci]`, commit `249da64b`). The lane's
  own tree is unchanged after `3a99f504` — `git diff --stat 3a99f504 -- ` on
  `scripts/ops/pick-truth-audit.ts`, `scripts/ops/pick-truth-audit.test.ts` and
  `package.json` is empty for all three. The validator's rule compares against
  every path rather than lane-authored paths, so any lane that synchronizes with
  main trips it. That is the same class of defect already routed to
  **UTV2-1790**, and it is not remediated here.

The binding history is preserved in `sha_binding.verified_source_sha_history`:
`daad7b00` (original bundle) → `149b60ee` (first main sync) → `f616d5cb`
(round-10 substantive head) → `3a99f504` (round-11 substantive head).

**Two earlier anchors are retracted rather than quietly overwritten.**

`149b60ee` became stale and its note was false. It read "every later commit
touches proof artifacts only." The seventh adversarial review measured that
claim and it failed by a wide margin: at `149b60ee` the audit is **1,105 lines
with 4 tests**, while the tree the bundle described at that time had **2,120
lines and 52 tests** (55 as of round 11). The entire P1-A/P1-B hardening — rounds 8, 9 and 10 — landed *after*
that anchor. A PM approving the bundle in that state would have been approving
code no SHA on the branch contained.

`f616d5cb` was correct for round 10 and became stale for the same structural
reason when round 11 landed `3a99f504`: three new tests and the three call-site
mutations they kill are outside `f616d5cb`. It is superseded here on the round
that made it stale, not a round later.

### Product truth is unchanged

The lane verdict stands as originally measured: **the historical production pick
population cannot support a trustworthy-pick claim.** Of 107,858 picks, exactly
1 is simultaneously non-fixture, fully identity- and provenance-complete, and
settled. Nothing in this synchronization softens that.
