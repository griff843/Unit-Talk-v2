# PROOF: UTV2-1745

MERGE_SHA: 149b60ee39eb662fe8c30757e7f1d8bbd7464814

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
      (`metadata.starts_at`, else `event_date + 'T23:59:59Z'`).
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
- [x] **A superseded settlement is never counted as an agreement.**
      `corrects_id IS NULL` excludes the corrections themselves, not the
      settlements they supersede; rows named by a later `corrects_id` fail
      closed as `settlement_superseded_by_correction`.
- [x] **Every correction carries a mutation control, and none survives.** Twelve
      independent mutations each turn at least one test red. An earlier round of
      this battery left two mutations **surviving** — removing the drift guard,
      and removing conflict detection — because the single combined scenario was
      blocked by either mechanism alone; two isolating tests were added
      specifically to kill them. Recorded below.
- [x] `pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts` — 23 pass,
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
1..23
# tests 23
# pass 23
# fail 0
# skipped 0
```

### Mutation controls — each correction is load-bearing

Every mutation below was applied to `scripts/ops/pick-truth-audit.ts` in
isolation, the suite re-run, and the file restored byte-exact. A control that
cannot fail proves nothing, so each is shown failing.

```text
mutation                                        result
------------------------------------------------------------------------
(none — corrected implementation)               23 pass, 0 fail
identity check removed from the grade ladder    17 pass, 6 fail
game_result event match dropped                 20 pass, 3 fail
game_result participant match dropped           21 pass, 2 fail
game_result market match dropped                22 pass, 1 fail
event-scoped drift guard removed                22 pass, 1 fail
market identity conflict detection removed      22 pass, 1 fail
closing table reverted to provider_offers       21 pass, 2 fail
snapshot_at closing cutoff dropped              21 pass, 2 fail
pinnacle bookmaker preference pass dropped      22 pass, 1 fail
superseded-correction check removed             22 pass, 1 fail
alias priority ordering removed (last-wins Map) 22 pass, 1 fail
read_only reverted to asserted literals         22 pass, 1 fail
(restored)                                      23 pass, 0 fail
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
reads (picks, game_results, events, participants, market_universe,
provider_market_aliases, and the pre-cutoff `provider_offer_history` snapshots)
were exported read-only from production `zfzdnfwdarxucxtaojxm` through the
Supabase MCP read path. Both the pre-fix and the corrected
`buildPickTruthAuditReport` were then executed over that identical dataset. Both
columns below therefore come from **running the shipped code**, not from a SQL
re-derivation of its semantics. **No write of any kind was issued.**

> An earlier revision of this section reported the pre-fix CLV column as 44
> resolvable (22%), obtained by re-deriving the audit's semantics in SQL. That
> figure is superseded: executing the pre-fix code itself over the same rows
> yields 4 resolvable. The direct replay is authoritative because it exercises
> the real resolution order rather than a restatement of it. The grading column
> is unaffected — both methods agree at 200/200.

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
disagreement rate           0.00%          0.00%

corrected unresolvable, by named reason
  game_result_identity_unverifiable          100
    - no pick-side event identity              99
    - no pick-side market identity              1
  game_result_event_mismatch                   0
  game_result_participant_mismatch             0
  game_result_market_mismatch                  0

transitions
  resolvable -> game_result_identity_unverifiable   100
  resolvable -> resolvable                          100
```

**100 of the 200 apparent agreements were manufactured by the circular event
resolution.** For those picks the only event identity available came from
`gameResult.event_id` — the very row being validated — so the old
implementation proved nothing about them. Under the corrected implementation
they are `game_result_identity_unverifiable`, not agreements. Where pick-side
identity does exist (100 rows), it agrees with the referenced row in every
case: zero event, participant or market mismatches. The corrected result is a
smaller, honest agreement basis, not a worse one.

### CLV — legacy `provider_offers` vs canonical `provider_offer_history`

```text
                              old      corrected
resolvable                      4             98
unresolvable                  196            102
resolvability rate          2.00%         49.00%

failure classes
  missing_closing_line        193              1
  missing_event_context         0             99
  missing_priced_side           2              2
  missing_participant_context   1              0

persisted clvStatus='computed' but currently unresolvable
                              176             82
```

Closing-line evidence for the corrected lookup:

```text
table queried                                provider_offer_history
distinct (event, market, participant) triples requested       95
triples with at least one eligible pre-cutoff snapshot        94
rows returned to the lookup                                  126
  of which bookmaker_key='pinnacle'                           17

legacy provider_offers, total rows                     8,191,206
legacy provider_offers, rows for any sampled event             0
```

The single triple with no eligible snapshot was re-queried with **no lower time
bound** and genuinely has no pre-cutoff row, so the bounded export did not
manufacture that failure.

The `provider_offers` row counts are the direct measurement behind P1-B: the
legacy surface is not empty in general — it holds 8.19M rows — but it holds
**nothing at all** for any event in this cohort. That is why the pre-fix audit
reported `missing_closing_line` for 193 of 200 picks.

Old-to-corrected transitions:

```text
old                          corrected                 n
missing_closing_line     ->  missing_event_context    98
missing_closing_line     ->  resolvable               94
resolvable               ->  resolvable                4
missing_priced_side      ->  missing_priced_side       2
missing_closing_line     ->  missing_closing_line      1
missing_participant_ctx  ->  missing_event_context     1
```

Both corrections move the measurement, in opposite directions, and both moves
are truthful:

- **94** picks the old audit reported as `missing_closing_line` do have a
  closing line. The old lookup was reading the legacy `provider_offers` surface;
  production reads `provider_offer_history`. The old audit was under-reporting
  CLV availability relative to production.
- **98** picks the old audit also reported as `missing_closing_line` are
  unresolvable for a different and more fundamental reason: their event context
  existed only because the referenced game result supplied it, so under
  independent identity they are `missing_event_context`. The old class label was
  wrong about the cause even where it was right about the outcome.

### Effect on the lane verdict

The verdict is **unchanged**: `can_currently_produce_trustworthy_pick: false`.
The materiality rules still fire — the CLV unresolvable rate is 51.00%, at or
above the 10% rule — and the 2026-08-26 population decomposition (1 of 107,858
picks simultaneously non-fixture, identity- and provenance-complete, and
settled) is untouched.

What changes is the **stated cause**, and it changes toward the truth. The
pre-correction bundle attributed the dominant CLV failure to
`missing_closing_line` (193 of 200) — an artifact of querying a frozen legacy
table. Corrected, that class holds a single pick and the dominant failure is
`missing_event_context` (99 of 200), the *same* root cause that makes 100 of
the 200 sampled grades unverifiable. The blocking defect is a single one:
**pick-side event identity is absent**, not closing-line data. Finding 6 below
records this.

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

6. **The blocker is one defect, not two.** The 2026-08-30 post-fix validation
   shows the closing-line data largely exists — 94 of 200 sampled picks the
   pre-correction audit called `missing_closing_line` resolve against the
   canonical `provider_offer_history`. Once CLV reads the source production
   actually reads, and once grading proves the referenced `game_results` row
   belongs to the pick, both failure surfaces collapse onto the same cause:
   the absence of pick-side event identity (99 of 200 for CLV, 99 of the 100
   unverifiable grades). Fixing event identity at admission time addresses both;
   nothing else in this lane's evidence needs a separate remedy.

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
verbatim and appends this lane's one entry — 131 entries, nothing removed, no
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

The file was then restored byte-exact (sha256
`c7bd926da3f028bc0c342df8837c3858b2b7ae60672da30dc1391eeb6c4e8ae7`), as were the
other three artifacts in this bundle. Lane-authored proof remains fail-closed;
inherited proof is correctly ignored.

### Re-verification on the synchronized head

```text
$ pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts
# tests 23
# pass 23
# fail 0

$ pnpm test:ops
# tests 2676
# suites 20
# pass 2676
# fail 0
# skipped 0

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

`verified_source_sha` moves from `daad7b00` to `149b60ee` — the merge commit is
now the last commit carrying a non-proof change. `sha_binding.merge_sha` is
`null`, as the shared schema-v2 evidence contract requires before a merge exists
(CEP-E7); the previous bundle carried a legacy top-level `merge_sha` holding a
branch SHA, which is exactly the "synthetic merge authority" the contract
forbids. No production count, finding, or verdict was altered.

### Product truth is unchanged

The lane verdict stands as originally measured: **the historical production pick
population cannot support a trustworthy-pick claim.** Of 107,858 picks, exactly
1 is simultaneously non-fixture, fully identity- and provenance-complete, and
settled. Nothing in this synchronization softens that.
