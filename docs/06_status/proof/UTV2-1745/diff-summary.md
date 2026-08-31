# UTV2-1745 — diff summary

MERGE_SHA: 3a99f5043e950b6f5610b26aab4d761bc8fc46fb

## Files changed

| File | Lines | Purpose |
|---|---|---|
| `scripts/ops/pick-truth-audit.ts` | +2120 | Read-only retrospective audit of the production pick population. Uses its own `ReadOnlyPostgrestClient`, which exposes HTTP `GET` only and has no write method. Recomputes grades independently from `game_results.actual_value` against each pick's own line and selection side rather than trusting the stored `status`, only after proving the referenced `game_results` row belongs to the pick (P1-A), and resolves CLV against the canonical `provider_offer_history` with production's resolver semantics (P1-B). CLV failures are classified by named cause. |
| `scripts/ops/pick-truth-audit.test.ts` | +2196 | 55 tests. Original 4: selection parsing and independent grade recomputation across over/under/push; itemized grading disagreements, named CLV failures and structural blockers; `missing_closing_line` is not collapsed into `missing_event_context`; the production transport exposes only `GET` and no write method. P1-A (7): wrong-event / wrong-participant / incompatible-market referenced rows are each unresolvable under their own named reason, a proven triple recomputes, an event-level total with a legitimately null participant stays valid, plus a negative control proving the wrong-event row *would* have agreed without the check and a structural control proving pick-side identity never reads the referenced row. P1-B (7): canonical table identity, closing cutoff exclusion, latest-eligible selection, event-level null participant, participant-scoped matching, pinnacle-then-consensus preference, plus a negative control reverting the lookup to `provider_offers`. Cohort and report integrity (3): a settlement superseded by a later `corrects_id` is never an agreement, alias resolution is deterministic under `providerMarketKeyPriority`, and `read_only` is measured from the transport rather than asserted. P1-A hardening, isolated (2): the drift guard and market-identity conflict detection each get their own scenario, because the combined attack is blocked by either one alone. Round 3 (6): a `metadata.providerMarketKey` naming a different market cannot validate itself into the candidate set, pick-side provenance still seeds identity when the alias table has no mapping, the closing cutoff is the pick's retained start time rather than the event date, a moneyline pick with a null participant is not a structural blocker, `createMarketUniverseClosingLookup` mirrors `findClosingLineByProviderKey`, and the odds gate does not refuse zero odds. Round 4 (10): a provider key owned by another market cannot seed identity (with a negative control showing it WOULD be admitted without the reverse index), a genuinely unowned key may still seed, CLV uses the event production graded against, the grading event is used for CLV only and never rescues a wrong-event row, the name-based participant fallback and its uniqueness rule, zero closing odds are priced (reverted in round 5), the offer lookup takes its event id from `events.external_id`, the participant external id comes from the participants table first, an `external_id` shared by two events is unverifiable rather than a mismatch, and selection-side branches run in production order. Round 5 (3, from the fourth adversarial review): a null participant issues the offer query production issues rather than bailing (asserting the captured `is.null` filter as the receipt), a grading context naming an unresolvable event fails closed under its own reason with a resolvable-event negative control, and a truncated page is refused rather than silently accepted. Round 6 (1, from the fifth adversarial review): a resolved grading context whose participantExternalId is null is not overridden by the market_universe/metadata resolver. The saturation test was rewritten in round 6 to exercise the case a length check misses -- 3 rows against a limit of 4 with 900 matching -- plus a missing-count refusal and a complete-page negative control. Test 35 was inverted in round 5: zero closing odds are `missing_priced_side`, because both callers of `readClosingSideOdds` test its return for truthiness and zero is falsy. Round 8 (4): `loadAuditDataset` is exported and driven end to end by a routing fetch stub, so its completeness guards finally carry controls -- a short participants name-fallback pool is refused, a pool page with no exact count is refused, a truncated forward `provider_market_aliases` page is refused, and a complete-pages negative control loads the dataset. Round 9 (1): a truncated REVERSE alias page is refused, added because the round-8 battery left that guard alive -- the earlier test truncated both alias pages so the forward read threw first, and the fixture carried no `providerMarketKey` so the reverse read had no ids and never ran. Round 10 (4, from the seventh adversarial review): the name-fallback pool is scoped to the pick's sport exactly as production scopes it, `loadAuditDataset` builds one pool PER SPORT and issues the sport filter production issues, a closing row production would discard skips the TIER rather than falling back within it, and a whitespace-padded `starts_at` is passed through untrimmed. Round 11 (3, from the eighth adversarial review): the round-10 tests exercised helper BODIES but never the CALL SITES, so deleting the `asProductionClosingLine` wrapper at the pinnacle tier, deleting it at the consensus tier, or reintroducing a trim at `buildGradingClvContext`'s `eventStartTime` left every test green — one call-site regression test each, and all three matching mutations now die. |
| `package.json` | +1 | Wires `scripts/ops/pick-truth-audit.test.ts` into `test:ops` so the suite actually executes under required `verify`. PM-authorized scope extension, recorded in the lane manifest's `scope_override` block. |
| `docs/06_status/lanes/UTV2-1745.json` | modified | Adds `package.json` to `file_scope_lock` plus the `scope_override` record. |
| `docs/06_status/proof/UTV2-1745/verification.md` | new | Proof bundle: verdict, assertions, live population evidence, findings. |
| `docs/06_status/proof/UTV2-1745/diff-summary.md` | new | This file. |
| `docs/06_status/proof/UTV2-1745/evidence.json` | new | Schema v2 evidence with SHA binding and live row counts. |
| `docs/06_status/proof/UTV2-1745/model-routing.json` | modified | Model routing record, bound to the merge SHA. |

## Design decisions, and what was deliberately not done

- **Read-only by construction, not by convention.** The audit's transport class
  has no write method at all, so it cannot issue a PostgREST mutation even if
  handed a service-role credential. `PickTruthAuditReport.read_only` is
  *measured* rather than asserted: it is derived from
  `ReadOnlyPostgrestClient.transportEvidence()`, a tally of the HTTP methods the
  client actually issued, so `database_writes_performed` counts non-GET requests
  instead of restating a hardcoded `0`. A literal cannot be falsified by a real
  write; a tally can.
- **Fail-closed target validation.** `parseCli` rejects any URL whose hostname is
  not `<project-ref>.supabase.co`, so a misconfigured environment cannot point
  the audit at an unintended database.
- **Independent regrade, not status trust.** Win/loss/push is derived from
  `game_results`, which is the only way a grading disagreement can be detected
  at all.
- **CLV failures are named, not collapsed.** A pick with event context but no
  closing offer is `missing_closing_line`; that distinction separates a data gap
  from a resolver bug, and collapsing it would have hidden the real cause.
- **P1-A — pick identity is established before the referenced row is used.**
  `buildPickIdentityContext` derives event, participant and market identity from
  the pick, its metadata, its `market_universe` provenance row, the canonical
  `events`/`participants` tables and `provider_market_aliases`. It takes no game
  result argument, so `gameResult.event_id` can no longer manufacture the
  identity it is then validated against. `validateGameResultIdentity` fails
  closed with `game_result_event_mismatch`,
  `game_result_participant_mismatch`, `game_result_market_mismatch` or
  `game_result_identity_unverifiable`; a wrong-but-real `game_results` id can
  never reach recomputation, so it can never be counted as an agreement.
- **P1-B — CLV reads the canonical production source.** `provider_offers` is the
  legacy/frozen surface. Production's resolver
  (`DatabaseProviderOfferRepository.findClosingLine`) reads
  `provider_offer_history`, and the audit now mirrors it filter-for-filter,
  including the `snapshot_at <= eventStartTime` closing cutoff, participant
  `eq`/`is null` semantics, `order snapshot_at desc limit 1` determinism, and
  `clv-service.ts`'s pinnacle-then-consensus preference with the
  `market_universe` fallback last. Mirroring rather than approximating is what
  keeps the audit from claiming CLV availability production would not have — or
  denying availability it would.
- **Production's drift guard and resolution order are ported, not approximated.**
  `isEventScopedTotalPick` reproduces `clv-service.ts` in full, including the
  guard that a `player_*` market, a `participant_id`, or player metadata
  disqualifies a game-total `market_type_id` from event scope — without it a
  drifted pick would be handed a null-participant `game_results` row and could
  still agree. Market identity candidates are narrowed to the pick-side provider
  key and the canonical key, and any additional non-aliasable claim fails closed
  as `game_result_identity_unverifiable`. On the CLV side, the `market_universe`
  provenance short-circuit runs *before* event context, cutoff and participant
  resolution exactly as production does, and the lookup key is resolved through
  the alias table only — never through pick metadata.
- **P1-A round 4 — alias ownership is checked in reverse.** The round-3 fix
  refused a pick whose provenance named a market key that conflicted with its own
  claims, but a pick whose canonical market had *no* alias row could still seed
  the candidate set from its own metadata — the self-validation defect relocated
  behind the unmapped branch. A reverse index (`provider_market_key` -> the set
  of `market_type_id`s that own it) is now loaded, and a claimed key owned by a
  *different* market fails closed. A key no `market_type_id` claims may still
  seed, so genuinely unmapped picks are not over-refused.
- **P1-B round 4 — the audited cohort's real production path is the grading
  path.** This cohort is `settlement_records` where `source='grading'`. Those
  rows are written by `recordGradedSettlement` / `recordCorrectedSettlement`
  (`apps/api/src/settlement-service.ts`), which call
  `buildCLVContextFromGradingEvent` and pass the result to the CLV service as
  `preResolvedContext` — and `preResolvedContext` short-circuits
  `resolvePickEventContext` entirely (`apps/api/src/clv-service.ts`). Production
  therefore takes its provider event id from
  `events.findById(gradingContext.eventId).external_id`, its cutoff from that
  event's `metadata.starts_at` (else `event_date + 'T23:59:59Z'`), and its
  participant from `participants.findById(pick.participant_id)` with a
  unique-normalized-`display_name` fallback. Reconstructing the event context
  instead was denying CLV that production actually has and reporting the gap as
  a production defect. The correction moved the measurement materially and
  truthfully. (Those intermediate CLV counts — `missing_event_context` 99 -> 0,
  `missing_closing_line` 1 -> 97, "CLV resolvable unchanged at 98/200" — are
  themselves **SUPERSEDED** by the round-11 replay, which measures 194 resolvable
  and 6 unresolvable. See `evidence.json` ->
  `post_fix_validation.round11_clv_replay` and the superseded-claims index. The
  *mechanism* correction described in this bullet stands; only its numbers are
  withdrawn.) Both superseded revisions are recorded in the evidence bundle
  rather than silently replaced.
- **The grading event id is admitted for CLV only, never for identity.**
  `apps/api/src/grading-service.ts` sets `gradingContext.eventId` to
  `gameResult.event_id`, so using it in the P1-A proof would reinstate exactly
  the circularity P1-A exists to remove. A test asserts a wrong-event row stays
  `game_result_identity_unverifiable` even when the grading context names that
  same wrong event.
- **Three more production-fidelity corrections.** (Round 4 also priced zero
  closing odds on the grounds that `readClosingSideOdds` gates on
  `Number.isFinite` alone. That was true of the helper and wrong about
  production — see the round-5 entry below, which reverts it.) An `events.external_id` shared by two rows is
  `game_result_identity_unverifiable`, not `game_result_event_mismatch` —
  asserting contradicted identity where the truth is merely unproven would be
  the same fail-open error in the opposite direction. Selection-side inference
  runs production's four sequential branches in order rather than two collapsed
  over/under families.
- **Round 5 — three divergences from production removed, one of them a
  regression round 4 introduced.** (1) `missing_participant_context` was an
  audit-invented bail. `computeCLVOutcome` passes a possibly-null
  `providerParticipantId` straight into `findClosingLine`, which filters
  `is(provider_participant_id, null)` — production *issues* the query. The class
  is also not a member of production's `CLVComputationStatus`, so the
  persisted-status comparison had been running against a state production can
  never have persisted. Removing it moved 3 picks to `missing_closing_line`,
  making the April half uniformly one failure reason. (2) Zero closing odds are
  refused again. Round 4 priced them because `readClosingSideOdds` gates on
  `Number.isFinite` alone — true of the helper, but it returns the raw number
  and both callers do `if (!pricedSide) return 'missing_priced_side'`
  (`clv-service.ts:415`, `:542`), and zero is falsy. Reading the helper without
  its callers inverted the semantics; production holds no zero-priced closing
  rows today, so the count did not move, but the claim did. (3) The moneyline
  decline is renamed `moneyline_clv_unreachable_on_grading_path`:
  `buildCLVContextFromGradingEvent` never sets `participantSide`, so moneyline
  CLV is unconditionally dead on this cohort's path, and the old name blamed an
  `event_participants` lookup the audit had merely not performed.
- **Two fail-open paths closed in round 5.** `readByIds` budgeted its `limit` for
  the whole id chunk rather than per id, so a few ids with many rows could push
  the others off the end — and a truncated read makes an ambiguous
  `events.external_id` look *unique*, failing open in exactly the place the
  ambiguity guard exists to close. The limit now escalates while saturated and
  the read is refused rather than guessed. Separately, a settlement naming a
  grading event that cannot be resolved no longer falls back to
  `events.external_id`, which would resolve where production's
  `resolvePickEventContext` returns `missing_event_context`; it fails closed as
  `grading_context_unresolvable`. Both are unreachable on the measured cohort and
  are guards against a future one.
- **Round 6 — the round-5 guard was itself fail-open, and a `??` reopened a
  closed hole.** The saturation check compared `rows.length` against the
  requested limit, but PostgREST caps every response at the project's `max_rows`
  setting: above that cap a truncated page arrives *shorter* than the limit and
  reads as complete. It now sends `Prefer: count=exact` and compares the rows
  read against the true matching total from `content-range`, which is exact
  regardless of any server cap, and the escalation ladder is gone. The same guard
  was extended to the forward and reverse `provider_market_aliases` pages, where a
  truncated page would change the resolved provider key. The participants
  name-fallback pager needed a *different* fix rather than the same one: with
  `count=exact` the header total is the full match count, so a per-page
  completeness assertion would always throw on a paged read. Its loop is now
  driven by that total instead of by `rows.length < PAGE` — the same fail-open
  terminator — and refuses if the server stops returning rows early. A short pool
  is the dangerous direction: it makes a genuinely non-unique display name look
  unique, and production resolves a participant only on a UNIQUE normalized-name
  match. (An earlier revision of this entry claimed the pager had already
  received the guard; it had been given `exactCount` and nothing read the count.
  The sixth review caught that.)
  Separately, `gradingClv?.participantExternalId ?? participantExternalId`
  re-admitted a participant production had resolved to `null` — production's own
  answer, which it passes into `findClosingLine` as `is.null`. That is the same
  over-claim class round 5 removed by deleting `missing_participant_context`,
  reintroduced by an operator; only an *absent* context falls back now.
- **A coverage gap found by review, then closed rather than documented.** The
  sixth review established that `loadAuditDataset` was module-private and wholly
  untested, so removing `assertCompletePage` from either alias call site, or
  reverting the participants name-fallback pager to a `rows.length` terminator,
  turned no test red — three guards that existed but were never proven. Writing
  that down as a limitation was not enough: a guard with no control is exactly
  what the mutation battery exists to reject. The loader takes its transport by
  injection, so it is now exported and driven end to end by a routing fetch stub,
  and each of its four guards carries a mutation control plus a complete-pages
  negative control.
- **The battery then caught the fix.** Round 8 ran 34 mutations against a
  47-test baseline and left ONE alive — `assertCompletePage` on the *reverse*
  alias read — for two independent reasons, **both in the test rather than the
  code**. The truncation test truncated *both* alias pages, so the forward read
  threw first and the reverse guard never executed; and the loader fixture
  carried no `market_universe` row and no `metadata.providerMarketKey`, so
  `claimedProviderKeys` was empty and the reverse read's loop body never ran at
  all. A test serving a complete forward page beside a truncated reverse one now
  isolates it. Round 9: 34 mutations, 48-test baseline, **0 survivors**. This is
  the third survivor across nine rounds, and all three had the same shape — the
  *fixture*, not the guard, decided the outcome.
- **Residual limitation, unrepaired and stated.** The shipped CLI has still
  never been executed end-to-end against production in this lane — the read key
  is unavailable under containment — so `createClosingOfferLookup`'s real query
  construction is exercised only by fixtures.
- **Five proof-integrity defects across two reviews, found and fixed rather than
  explained.** The pasted unit-test output had been extended to 42 `ok` lines
  while its footer still read `1..39 / # tests 39` — the count was right but the
  block was assembled, not captured; it is now a verbatim run. And the replay's
  closing-line lookup was a substitute: it applies the same predicates and
  honours `bookmakerKey`, but returns every matching row instead of the shipped
  query's `order snapshot_at desc limit 1`. `selectLatestClosingOffer` picks the
  same row either way, so no CLV outcome moves — but the shipped query's own
  construction was never exercised against production rows, only against unit
  fixtures that assert the captured PostgREST parameters. The substitution and
  its limits are now stated in **both** `evidence.json` and `verification.md` —
  an earlier fix touched only the former, so a reader of the proof document alone
  still saw the defect. Three further inconsistencies the sixth review found are
  also fixed: a pasted `test:ops` receipt reading 2695 when the round-6 tree
  produced 2696 (the round-11 merged head produces 2708, and every receipt in this
  bundle is re-captured at the head it describes), an `evidence.json` mutation block
  still carrying the round-4 battery (25 rows, baseline 39) beside a note
  claiming 30 and 43, and two assertions still describing mechanisms later rounds
  had replaced.
- **Every control was proven by making it fail.** Forty-two semantic
  mutations, each applied in isolation and reverted byte-exact, each turn at
  least one test red. Three rounds left a survivor, and each was killed by adding
  an isolating test rather than by weakening the mutation: round 2 left the drift
  guard and conflict detection alive because one combined scenario was blocked by
  either mechanism alone; round 4 left `gradingClv = null` alive because the
  fixture's `market_universe` row still pointed at the right event; round 8 left
  the reverse alias assertion alive because the test truncated both alias pages
  and the fixture gave the reverse read no ids. The battery grew by round, and each
  count below is attributed to the round that produced it rather than left to be
  read against the current total: six of the **round-9 battery's thirty-four**
  were added in rounds 5 and 6, three of which invert decisions an adversarial
  review overturned; five more in rounds 8 and 9 cover `loadAuditDataset`; five
  in round 10 cover the sport-scoped participant pool, the mirrored closing-line
  validity gate, and the untrimmed `starts_at`, taking the battery to
  thirty-nine; and three in round 11 cover the two `asProductionClosingLine`
  call sites and the `buildGradingClvContext` event-start trim, taking it to the
  **forty-two** run against the current head — 34 + 5 + 3 = 42. Presence and a
  green run prove nothing on their own.
- **The seventh review found the largest P1-B defect of the lane, on the
  dominant code path.** The name-based participant fallback was not scoped by
  sport. Production calls `participants.listByType('player', metadata.sport)`
  and `listByType` applies `.eq('sport', sport)` when sport is truthy, so the
  candidate pool belongs to the *pick*. The audit pooled every sport together
  under a bare normalized-name key, and collapsed to an all-players pool as soon
  as any one pick lacked `metadata.sport`. That diverges in **both** directions —
  a name shared across sports reads as ambiguous and denies CLV production has
  (booking a false `persisted_computed_but_currently_missing_closing_line`
  mismatch, the very resolver-bug signal the report exists to surface), while the
  resulting null participant emits `is.null`, which can match an event-scoped
  history row production's `eq.<player>` query never sees. With 94.4% of the
  audited picks carrying a null `participant_id`, this was the dominant path.
  Fixed by keying the index `${sport}|${name}`, building one pool per sport, and
  threading the pick's sport into the lookup.
- **Why six rounds of mutation testing missed it.** Test 34 handed
  `buildGradingClvContext` a **pre-built** index, so the pool construction in
  `loadAuditDataset` never executed, and its ambiguity fixture placed both
  players in `sport: 'NBA'` — the cross-sport case was unreachable. The mutation
  that dropped the name fallback killed only the lookup branch, never the pool.
  This is the third time the *fixture*, not the mechanism, decided the outcome
  (after the round-2 drift guard and the round-8 reverse-alias guard). The new
  tests drive the pool through `loadAuditDataset` and assert the sport filter
  actually reached the query.
- **Two more production divergences mirrored rather than noted.**
  `asClosingLineLike` is now applied to every closing row — *after* latest-row
  selection, so a discarded row skips the tier instead of falling back to a
  second-latest row production never fetched — and `starts_at` is passed through
  untrimmed, because production tests it trimmed but returns it raw into the
  `lte.` cutoff filter.
- **The audit stayed read-only and self-contained.** Both corrections live
  entirely inside `scripts/ops/pick-truth-audit.ts`. Nothing under
  `packages/db/**`, `apps/api/**` or `supabase/migrations/**` is modified;
  production code is read as a reference only.
- **No remediation of any kind.** No regrade write, backfill, CLV persistence,
  replay, production mutation, or schema change. The 107,858 historical picks
  are not repaired and must not be represented as trustworthy.
- **Forward-flow trustworthiness is out of scope.** It is a separate successor
  and requires explicit event identity, participant identity, standardized
  selection, line and source provenance, settlement traceability, and
  closing-line capture as first-class admission-time fields.

## Blast radius

None. Merging this PR adds a read-only script and its tests. No production
mutation is performed or enabled, and no runtime path changes.

## Main synchronization (2026-08-30)

Merge commit `149b60ee39eb662fe8c30757e7f1d8bbd7464814` merges
`origin/main` (`e9f62e5e164edd861606334d479eb4c7ef1762f3`) into this lane.

| File | Change | Purpose |
|---|---|---|
| `package.json` | 1 line | Sole conflict. Resolved to current main's complete `scripts.test:ops` (130 entries, incl. `scripts/ops/outbox-triage.test.ts` from UTV2-1744) plus this lane's `scripts/ops/pick-truth-audit.test.ts` = 131 whitespace-separated tokens, of which 128 are test-file arguments (main: 130 tokens / 127 files). Nothing removed. |

The merge's combined diff contains that one file and nothing else: no content
inherited from `main` was re-authored, and no other lane's proof bundle was
touched. Proof artifacts were re-anchored to that merge commit at the time
(`verified_source_sha` `daad7b00` -> `149b60ee`). **That anchor is no longer the
binding**: rounds 8-11 landed substantive code after it, so the final binding is
`3a99f504` — see "Final proof binding" below. `sha_binding.merge_sha` remains
`null` pre-merge. Production counts from the 2026-08-26 read-only
measurement are unchanged.

## Final proof binding

`sha_binding.verified_source_sha` = **`3a99f5043e950b6f5610b26aab4d761bc8fc46fb`**,
the last commit on this branch authoring a change to any non-proof file (the
three round-11 call-site regression tests). Binding history is preserved in
`verified_source_sha_history`: `daad7b00` -> `149b60ee` -> `f616d5cb` ->
`3a99f504`.

The earlier `149b60ee` anchor carried the note "every later commit touches proof
artifacts only." That was false once rounds 8-10 landed: at `149b60ee` the audit
is 1,105 lines with 4 tests, against the 2,120 lines and (at that time) 52 tests
this bundle describes. The seventh adversarial review caught it. `f616d5cb` was
correct for round 10 and became stale the moment round 11 landed `3a99f504`.
Both are retracted in `verified_source_sha_history` rather than silently
replaced.

The one commit after the binding, `c4715923`, is the third main synchronization
(`origin/main` `249da64b`). Its entire delta against the bound SHA is one
upstream bot ledger file:

```text
$ git diff --name-status 3a99f504 c4715923
M	docs/06_status/readiness/readiness-score.json
```

`scripts/ops/pick-truth-audit.ts`, `scripts/ops/pick-truth-audit.test.ts` and all
proof artifacts are byte-identical across `3a99f504` and `c4715923`.
`sha_binding.merge_sha` stays `null` pre-merge; `post-merge-lane-close.yml` binds
it to the real merge commit.

That third synchronization did **not** route through
`pnpm ops:merge-wrapper git-merge-main`, and is recorded as a **process
deviation, not a precedent**. The wrapper's `git-merge-main` verb emits
`git merge --ff-only origin/main` (`scripts/ops/ops-merge-wrapper.ts:88-108`),
which can never succeed on a branch carrying its own commits, so the safe
non-rebasing exit UTV2-1678 advertises is unreachable for every lane that has
committed anything. The defect is routed to the **UTV2-1790** owner; that
worktree was not touched and no second wrapper lane was opened. The merge was
performed directly as `git merge --no-ff --no-edit origin/main` with the
wrapper's dropped-path check replicated by hand. Full admissibility evidence —
first-parent ancestry, parent-2 identity with `origin/main`'s exact tip, the
complete two-sided path diff, zero dropped paths on either side, zero commits
behind main, and a clean worktree — is in `evidence.json` ->
`main_synchronization.history[2].admissibility_evidence` and in
`verification.md` -> "Synchronization with main — a recorded process deviation".

## Round-12 proof-only remediation

The ninth independent adversarial review returned CHANGES_REQUIRED with nine
findings — 2 P1, 4 P2, 3 P3. All nine are repaired, and **every repair is
proof-only**: `scripts/ops/pick-truth-audit.ts`,
`scripts/ops/pick-truth-audit.test.ts` and `package.json` are byte-identical to
their state at `3a99f504` (`git diff --stat 3a99f504 -- <path>` is empty for all
three), so the anchor remains mechanically correct and no shipped audit logic,
package behaviour or production execution semantic changed.

The full disposition matrix is in `verification.md` → "Round-12 remediation —
disposition of every ninth-review finding" and, machine-readably, in
`evidence.json` → `round12_remediation.matrix`. In brief:

- **The shipped `systemic_defect` detector flipped `true` → `false`** between
  rounds 10 and 11 and that had gone undisclosed. It is now disclosed
  prominently, with both rounds' verbatim output and the cause of each: the
  detector implements only two threshold rules, and the corrected CLV
  unresolvable rate (3%) fell below the 10% rule that fired in round 10. It is
  stated explicitly that this does **not** mean the cohort is trustworthy — the
  detector has no rule for grading unverifiability or structural blockers, which
  are the two conditions carrying the verdict at 50% each. The verdict is
  produced by separate logic, is `false` in both rounds, and did not move. No
  hand-authored materiality rule was added to compensate; expanding the detector
  is recorded as a proposed successor issue and deliberately not done here.
- **The withdrawn "persisted `computed` but unresolvable = 82" has a measured
  successor**, now reported as Finding 7: 16 of 200 (8.00%) persisted-`clvStatus`
  mismatches, split 13 / 2 / 1, each traceable to a cohort row in
  `report11.json`.
- **Five self-invalidating Git and CI receipts were pinned.** The bundle printed
  `git diff --name-status 3a99f504 HEAD` asserting a fixed result — and
  committing that assertion moved `HEAD` and falsified it. A sweep for the same
  defect class found four more (`git rev-parse origin/main`,
  `origin/main...c4715923`, `r-level-check --base origin/main --head HEAD` in two
  places, `git show HEAD`, `git diff HEAD origin/main`), two of which had already
  drifted. All are now pinned to immutable SHAs and were re-executed against
  them; the one leg that cannot be pinned is stated as a property for the
  reviewer to verify rather than as asserted output.
- **Three further corrections:** the round-10 harness emptied **three**
  `picks.metadata` objects, not one (ids listed, independently re-measured); the
  102,155 `market_universe` denominator now carries an executed receipt (Q9,
  with server-clock timestamp and an internal reconciliation, no credentials);
  and `.out/replay/derive_final.ts` is retained so the authoritative per-row
  artifact — including `source_exact` and `cutoff_enforced`, previously derived
  by undocumented manual steps — reproduces from retained inputs alone.
- **The three P3s are resolved:** the rung-4 cutoff proxy is named
  (`market_universe.last_offer_snapshot_at`) and its weaker inference stated;
  Q7's probe accounting is generated from a machine
  receipt rather than restated (94 alive triples × 2 tiers = 188 probes, 4
  batches of `24/24/24/22` **triples**, 111 non-empty results, **111** rows —
  `.out/replay/q7_receipt.json`); and the mutation counts are attributed by
  round (34 + 5 + 3 = 42).

Re-verified before review: 55 lane tests pass / 0 fail, `pnpm test:ops` 2708 / 0,
`pnpm type-check` exit 0, every partition reconciles to 200, all 18 retained
artifact digests re-validate after a clean re-execution of both replay scripts,
and the round-12 commit's file scope is exactly three files, all of them in
this proof bundle — stated with immutable endpoints and a retained receipt
(`git diff --name-only b10d8aa8 3f2f4ba8`, captured in
`.out/receipts/round12-commit-scope.txt`) rather than as a claim about mutable
worktree state, which committing the claim would itself have falsified.

## Round-13 final proof closure

The tenth independent review confirmed all nine round-12 repairs and returned
CHANGES_REQUIRED on five further findings — one P2 and four P3. All five are
corrected. **Every correction is proof-only**; the only non-document changes are
to retained replay scripts under `.out/`, which is gitignored and never shipped.
`scripts/ops/pick-truth-audit.ts`, `scripts/ops/pick-truth-audit.test.ts` and
`package.json` remain byte-identical to `3a99f504`.

- **Q7's row count was wrong, and it was my error.** Round 12 published
  "1,221 offer rows" — the sum of the *field* counts of 111 retained row objects
  (111 × 11), not a row count — and it contradicted this bundle's own
  `evidence.json`, which has always recorded `rows_returned: 111`. The
  authoritative figure is **111**, forced by `limit 1`. It now comes from
  `.out/replay/q7_receipt.json`, generated by a script that *asserts* one row per
  non-empty probe and throws if that stops holding.
- **The batch structure is `24/24/24/22`**, counted from the retained batch SQL,
  corrected in prose and in `evidence.json` → `Q7.statement`. "4 batches of 24"
  is gone in every variant; the total, 94, equals the alive-triple count.
- **The self-invalidating worktree claim is gone.** The round-12 commit's file
  scope is now stated with immutable endpoints and a retained receipt
  (`.out/receipts/round12-commit-scope.txt`) instead of as a claim about mutable
  state that committing it would falsify.
- **The derivation scripts are portable, and it was proven.** Every absolute path
  is gone from `derive_final.ts`, `replay11.ts`, `parity.ts` and `attribute.ts`;
  running `derive_final.ts` from a different checkout path produces the identical
  `per_row11_final.json` digest.
- **The validator output is captured verbatim** in
  `.out/receipts/proof-binding-validator.txt` and referenced, not paraphrased.
  The **vacuous equality claim is removed**: the comparison now covers only the
  ten fields present on both artifacts, and names `source_exact` and
  `cutoff_enforced` as not comparable because the older artifact lacks them.

**The underlying failure was manual transcription, so that step was removed.**
Five retained scripts now generate what the proof asserts —
`q7_receipt.ts` (Q7 quantities), `matrix_check.ts` (executes the verification
command for all 14 findings), `render_matrix.ts` and `render_digests.ts` (render
the matrix and digest tables from those results), and `contradiction_scan.ts`,
which scans the whole bundle for numbers disagreeing with their structured
source, withdrawn figures asserted as live, and self-invalidating receipts. The
matrix reports **14/14** and the scan reports **NO CONTRADICTIONS**, both stable
across repeated regeneration.
