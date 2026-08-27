# PROOF: UTV2-1745

MERGE_SHA: 1b9688bb130098c1eecdd41e2274ff142e529050

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
- [x] `PickTruthAuditReport.read_only` is typed with the literals
      `database_writes_performed: 0`, `write_method_reachable: false`, and
      `transport_method: 'GET'` — a future edit that tries to relax any of them
      fails type-check rather than silently changing the contract.
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
- [x] `pnpm exec tsx --test scripts/ops/pick-truth-audit.test.ts` — 4 pass,
      0 fail.

## Runtime Verification

The CLI could not be executed locally: production containment neuters
`local.env` (`SUPABASE_URL=http://127.0.0.1:1`) and this session holds no
production `PICK_TRUTH_AUDIT_READ_KEY`. Live population evidence was therefore
read through the Supabase MCP read path against project `zfzdnfwdarxucxtaojxm`
on 2026-08-26. Every statement below is a `SELECT`.

EVIDENCE:

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
1..4
# tests 4
# pass 4
# fail 0
# skipped 0
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
Changed files: 17
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

## Scope and refusals

Read-only. No regrade, backfill, CLV persistence, replay, production write, or
schema change was performed or is enabled by this lane.

This lane explicitly does **not** attempt to repair the 107,858 historical
picks, and the population must not be represented as trustworthy. Making
forward-flow picks trustworthy is a separate successor and requires, at
admission time and as first-class fields rather than free-form metadata:
explicit event identity, participant identity, standardized selection, line and
source provenance, settlement traceability, and closing-line capture.
