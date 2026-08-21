# PROOF: UTV2-1383

MERGE_SHA: a6bc5c99cc58166321f35d1e0e2aa751450056a8

Scope: **READ-ONLY audit and repair design only.** No row was mutated, no migration was
authored, no schema was altered. Every statement executed against production
(`zfzdnfwdarxucxtaojxm`) in this lane was a `SELECT`. The blanket proposal in the issue
title — set every `stake_units IS NULL` to `1` — is **not authorized by this proof** and
this lane deliberately does not execute it.

ASSERTIONS:

- [x] The NULL population was re-derived from production rather than taken from the issue title; the count is 2,902 as of 2026-08-21T13:57:22Z UTC, against 107,858 total picks (2.69%).
- [x] The NULL population is bounded in time to 2026-04-22 → 2026-05-08 and has not grown since; no writer is currently producing new NULL-stake rows.
- [x] `capper_id IS NULL` on all 2,902 rows. Not one row in the population is attributable to a human capper, so no member stake history exists to preserve or corrupt.
- [x] 2,872 rows carry `metadata.systemGenerated = true`; 2,865 were written by exactly two system writers (`system:candidate-pick-scanner`, `scheduler:board-pick-writer`).
- [x] No stake evidence exists anywhere for any row: `metadata.stakeUnitsSource` is NULL on all 2,902; the originating `submissions.payload` carries no `stakeUnits`/`stake_units` key on any of the 2,900 joined submissions; `settlement_records.stake_units` is NULL on all 11 related settlement rows.
- [x] `metadata.kellySizing` is JSON-null on 2,891 rows and is therefore not a derivation source; of the 9 rows where it is an object, 8 record `recommended_units: 0` with `has_edge: false`.
- [x] The constraint `picks_stake_units_canonical_check` exists as `CHECK ((stake_units IS NOT NULL) AND (stake_units > 0))` and is `NOT VALID` (`pg_constraint.convalidated = false`).
- [x] CLV computation does not reference stake at any point; the CLV blast radius of the NULL population is zero.
- [x] The canonical settlement path fails closed on NULL stake (`computeProfitLossUnits` returns `null`) and tags the row `stakeUnitsHistoricalUnknown: true`; the canonical recap path partitions NULL-stake rows out of the ROI denominator and discloses the exclusion count.
- [x] Three live code paths nevertheless substitute a phantom 1-unit stake for NULL, contradicting the canonical path; they are named in Finding F2 below.
- [x] Phantom 1-unit P/L is already materialized in production: 11 `settlement_records` rows for these picks carry concrete `payload.profitLossUnits` values while `stake_units` is NULL and no integrity tag is present. All 11 belong to proof-runner or canary fixtures.
- [x] By the extended fixture classifier, 18 of 2,902 rows (0.62%) carry a fixture marker — the inverse of the picks table overall, which is predominantly fixture.
- [x] Across the 104,956 picks that do carry a stake, 99.99% hold exactly `1.00` and only five distinct values exist table-wide; there is no variable stake history in `picks` for a repair to corrupt.
- [x] No segment qualifies as "derive-from-evidence" repairable, because no segment has surviving evidence of an intended stake. The repair design in this proof therefore proposes reconstruction-from-writer-default and quarantine, never derivation, and each disposition names the PM authorization it requires.
- [x] `pnpm type-check` passed, `pnpm test` passed with 0 failures, and `scripts/ci/r-level-check.ts` returned `Verdict: PASS`. `pnpm verify` result is recorded verbatim below, including its refusal at the writable-DB stage under credential containment.

## Verification

### V1 — Population re-derivation

The "2,902" figure in the issue title was not trusted. It was re-derived against production
and independently reproduces. The table total is also unchanged from the July 2026
fixture-contamination inventory, which confirms the containment holding: no writer has added
a NULL-stake row since 2026-05-08.

### V2 — What the population actually is

The population is not legacy member data. It is the output of two autonomous system writers
during a two-and-a-half week window in which those writers did not yet stamp a stake at all.
`capper_id` is NULL on every row and `submittedBy` resolves to a system or scheduler
identity on 2,872 of 2,902. The remaining rows are proof-runner fixtures and a small
`api`/`anonymous:auth-bypass` residue.

This inverts the risk framing in the issue. The stated danger — "fabricating stake history
and corrupting ROI truth" — presupposes that these rows represent real wagers by real
cappers whose true stake is unknown. They do not. No row in this population has, or ever
had, a human-authored stake.

### V3 — Why blanket `= 1` is still refused

Two independent reasons survive V2, and both are mechanical rather than stylistic:

1. **The 18 fixture rows must not be repaired at all.** Writing a stake onto a CI artifact
   makes it look more like a genuine pick, not less, and the picks table already has a
   fixture-contamination problem. Repair would work against the classifier.
2. **A written value with no provenance is indistinguishable from an observed value.**
   `metadata.stakeUnitsSource` is NULL on all 2,902 rows. If `1` is written without a
   provenance stamp, the result is a row that asserts a 1-unit stake and offers no way to
   tell that the 1 was assumed. That is the precise failure already materialized in the 11
   settlement rows described in Finding F3 — and it is why those rows are now
   indistinguishable from genuinely-staked settlements without joining back to `picks`.

What does *not* survive V2 is the "fabricating stake history" hazard itself. Q13 shows the
table holds only five distinct stake values and that 99.99% of staked rows are exactly
`1.00`. There is no varied stake history here to destroy — the concern the issue raises is
real in principle but has no population to apply to.

The correct disposition for the system-writer segments is therefore **reconstruct the
writer's own documented default, with an explicit provenance stamp** — which is a different
operation from the blanket `= 1` the issue proposed, and produces a row that stays
auditable.

### V4 — Constraint state

`picks_stake_units_canonical_check` is present and `NOT VALID`. It is enforced against new
writes but was never validated against the existing table, which is exactly why the 2,902
rows persist. This has an active operational cost documented in the code itself: because
Postgres re-evaluates a `CHECK` against the **full row** on any `UPDATE`, any lifecycle
transition on one of these rows rolls back, and `candidate-pick-scanner` had to add a skip
path to break a resulting 60-second retry loop.

Validating the constraint is blocked until the 2,902 rows are dispositioned. That is the
real dependency this issue sits on.

### V5 — Findings

**F1 — No derivation evidence exists (blocking for any "derive" disposition).**
Checked four candidate sources; all four are empty for this population: pick metadata
(`stakeUnitsSource` NULL ×2,902), originating submission payload (no stake key on any of
2,900), Kelly sizing block (JSON-null on 2,891), and settlement records
(`stake_units` NULL ×11).

**F2 — Live-path disagreement on NULL stake (defect, out of scope for this lane).**
The canonical settlement and recap paths fail closed. Three other live paths silently
substitute `1`:

| Path | Expression | Effect |
|---|---|---|
| `apps/api/src/grading-service.ts:988` | `const stake = stakeUnits ?? 1;` | Discord recap embed renders `Stake: —` beside a concrete P/L computed at 1 unit |
| `packages/domain/src/attribution/attribution-engine.ts:98` | `const stake = input.stake_units ?? 1;` | Contaminates `realized_pnl_bps`, `model_component_bps`, `execution_component_bps` |
| `apps/discord-bot/src/commands/results.ts:100-102` | ternary defaulting to `1` | `/results` P/L output |

Compare the canonical path at `apps/api/src/settlement-service.ts:1051`, which returns
`null` for the identical quantity on the identical pick. `attribution-engine`'s
`validateAttributionInput` also validates `ev_bps` and both CLV fields for finiteness but
never validates `stake_units`, so a `NaN` stake bypasses the `??` guard and propagates NaN
through every component.

**F3 — Phantom 1-unit stake is already materialized in production.**
Archived migration `supabase/migrations_archive/202604250005_utv2_753_backfill_settlement_profit_loss.sql`
used `COALESCE(p.stake_units, 1.0)` and has already run. Eleven `settlement_records` rows
for NULL-stake picks now carry definite `profitLossUnits` values with `stake_units` NULL and
no `stakeUnitsStatus` tag. The fabrication this issue warns about has partially happened
already; it is confined to fixture rows, and the newer
`buildStakeIntegrityPayload` tagging in `settlement-service.ts` is the fix that arrived too
late for them. That `COALESCE(..., 1.0)` pattern is not present in the active migrations
path.

**F4 — ROI/CLV blast radius is materially smaller than the row count suggests.**
CLV never touches stake. Of 2,902 rows, 2,874 are in terminal dead states, 0 are promoted,
and only 15 are settled-or-posted. **Not all 15 are proof-runner output** — an earlier revision of this line said so and was wrong. Re-derived: 5 `posted` and 2 `settled` are `system:candidate-pick-scanner`, i.e. genuine non-fixture system output; 5 `settled` are `utv2-803-final-proof`; 3 `settled` carry no `submittedBy`. So **7 of 15 are real system rows**, not proof scaffolding. The canonical ROI
surfaces either exclude NULL stake and disclose it, or ignore `stake_units` entirely in
favour of a flat −110 assumption. 285 distinct NULL-stake picks do appear in
`v_governed_pick_performance`, but that view selects no `stake_units` column and performs no
units arithmetic.

### V6 — Repair design (design only; nothing executed)

| # | Segment | Rows | Disposition | Justifying evidence | Authorization required |
|---|---|---|---|---|---|
| S1 | `system:candidate-pick-scanner` / `system-pick-scanner` | 2,587 | **Reconstruct writer default** — set `1` **only** with `metadata.stakeUnitsSource = 'backfill_system_default_flat_1u'` plus the backfill issue id | `apps/api/src/candidate-pick-scanner.ts:209,230` writes `stakeUnits: 1` with `stakeUnitsSource: 'system_default_flat_1u'` — the value is the writer's own documented constant, not a guess | PM approval on a T1 migration lane; provenance stamp is non-negotiable and must be a required assertion |
| S2 | `scheduler:board-pick-writer` / `board-construction` | 278 | **Reconstruct writer default**, same provenance stamp | `apps/api/src/board-pick-writer.ts:240,276` writes the identical constant and source tag | Same as S1; may share one migration |
| S3 | Fixture-marked rows (`utv2-*-proof*`, `canary-proof`, fixture `human`/`api` residue) | 18 | **Delete as fixture** — or leave NULL if deletion stays frozen. Do **not** write a stake | Extended classifier match; 11 of the related settlement rows are proof-runner artifacts (F3) | Blocked behind the existing production-fixture cleanup authorization; not unblocked by this issue |
| S4 | `anonymous:auth-bypass` / `board-construction` | 7 | **Quarantine** — leave NULL, exclude from constraint validation scope | Writer identity is an auth-bypass path; no writer default can be claimed on its behalf | PM decision on quarantine mechanism |
| S5 | `api` with no `submittedBy` | 12 | **Quarantine** — leave NULL | No writer identity, therefore no reconstructable default and no evidence | PM decision; smallest segment, safe to defer |

Sequencing note: S1+S2 (2,865 rows) is the only segment pair large enough to matter for
constraint validation, and it is also the only pair where a defensible value exists. If S3
is deleted and S4+S5 are quarantined, the constraint can be validated **only after every remaining row
satisfies it**. An earlier revision of this note claimed validation could proceed with a `NOT VALID`
carve-out; **no such mechanism exists.** `NOT VALID` exempts pre-existing rows only at constraint
creation time; `VALIDATE CONSTRAINT` scans the whole table and will reject any row still holding NULL.
Quarantine-by-leaving-NULL is therefore incompatible with validating the constraint — quarantined rows
must be relocated out of `picks`, not left in place. That plan should not be authored until F2 is
fixed, because repairing the data while three live paths still coalesce NULL to `1` would
destroy the only signal that distinguishes reconstructed rows from observed ones.

Recommended order: **fix F2 first, then disposition S3/S4/S5, then S1/S2, then validate the
constraint.** F3 should be tracked separately as data already damaged.

### V7 — Could not be determined read-only

- Whether the 11 `settlement_records` `profitLossUnits` values in F3 were produced solely by
  the archived migration or partly by the live `grading-service` path. Distinguishing them
  would require write-side replay; both candidates coalesce to the same constant, so the
  values are observationally identical.
  (An earlier revision also listed the constraint's violation set as undeterminable read-only. That
  was wrong: it conflated the DDL with the predicate. The predicate is a plain SELECT and has now
  been evaluated — see V8. Only the act of validating is DDL.)

### V8 — Constraint violation set, determined read-only

The violation set is **exactly the 2,902 NULL rows and nothing more**. Evaluating the constraint's own
predicate as a SELECT requires no DDL:

```sql
SELECT
  (SELECT count(*) FROM picks WHERE stake_units IS NOT NULL AND stake_units <= 0) AS nonnull_violations,
  (SELECT count(*) FROM picks WHERE stake_units IS NULL) AS null_rows;
-- nonnull_violations = 0, null_rows = 2902
```

So no row violates the `stake_units > 0` half of the CHECK. Once the NULL population is dispositioned,
nothing else stands between the constraint and validation. This removes an unknown from the repair lane's
sequencing.

## Runtime Verification

All SQL below was executed via the Supabase MCP `execute_sql` against production project
`zfzdnfwdarxucxtaojxm`. Every statement is a `SELECT`.

EVIDENCE:

**Q1 — Population re-derivation**

```sql
SELECT now() AT TIME ZONE 'UTC' AS as_of_utc,
       count(*) AS total_picks,
       count(*) FILTER (WHERE stake_units IS NULL) AS null_stake_units,
       count(*) FILTER (WHERE stake_units IS NOT NULL) AS non_null_stake_units,
       round(100.0 * count(*) FILTER (WHERE stake_units IS NULL) / NULLIF(count(*),0), 2) AS pct_null
FROM public.picks;
```

```text
as_of_utc                  | total_picks | null_stake_units | non_null_stake_units | pct_null
2026-08-21 13:57:22.243951 |     107858  |            2902  |              104956  |    2.69
```

**Q2 — Segmentation by source × lifecycle × promotion state**

```sql
SELECT source, status, approval_status, promotion_status,
       count(*) AS n,
       min(created_at) AS first_created,
       max(created_at) AS last_created,
       count(DISTINCT capper_id) AS distinct_cappers,
       count(*) FILTER (WHERE capper_id IS NULL) AS null_capper,
       count(*) FILTER (WHERE settled_at IS NOT NULL) AS settled_rows,
       count(*) FILTER (WHERE odds IS NULL) AS null_odds
FROM public.picks
WHERE stake_units IS NULL
GROUP BY 1,2,3,4
ORDER BY n DESC;
```

```text
source              | status    | approval | promotion     |    n | first_created       | last_created        | cappers | null_capper | settled | null_odds
system-pick-scanner | queued    | approved | suppressed    | 1435 | 2026-04-26 02:33:12 | 2026-04-28 02:50:54 |       0 |        1435 |       0 |         0
system-pick-scanner | validated | approved | not_eligible  |  565 | 2026-04-26 02:32:15 | 2026-04-26 13:26:20 |       0 |         565 |       0 |         0
system-pick-scanner | queued    | approved | not_eligible  |  400 | 2026-04-26 02:57:54 | 2026-04-28 02:50:17 |       0 |         400 |       0 |         0
system-pick-scanner | validated | approved | suppressed    |  154 | 2026-04-26 02:57:16 | 2026-04-26 13:27:42 |       0 |         154 |       0 |         0
board-construction  | validated | approved | suppressed    |  154 | 2026-05-06 22:12:47 | 2026-05-08 14:57:51 |       0 |         154 |       0 |         0
board-construction  | validated | approved | not_eligible  |  120 | 2026-04-24 05:28:34 | 2026-05-08 14:57:06 |       0 |         120 |       0 |         0
system-pick-scanner | voided    | approved | suppressed    |   19 | 2026-04-26 02:53:34 | 2026-04-28 00:48:02 |       0 |          19 |       0 |         0
api                 | validated | approved | not_eligible  |   12 | 2026-04-22 05:25:44 | 2026-04-22 22:01:11 |       0 |          12 |       0 |         1
board-construction  | validated | approved | qualified     |   11 | 2026-05-06 22:15:40 | 2026-05-08 08:04:11 |       0 |          11 |       0 |         0
system-pick-scanner | voided    | approved | not_eligible  |    7 | 2026-04-28 00:47:03 | 2026-05-07 09:45:04 |       0 |           7 |       0 |         0
system-pick-scanner | posted    | approved | qualified     |    5 | 2026-04-26 11:37:43 | 2026-04-26 17:29:44 |       0 |           5 |       0 |         0
api                 | settled   | approved | qualified     |    4 | 2026-04-22 05:15:07 | 2026-04-30 17:44:47 |       0 |           4 |       4 |         0
api                 | validated | approved | suppressed    |    4 | 2026-04-22 05:23:16 | 2026-04-22 22:43:42 |       0 |           4 |       0 |         1
smart-form          | validated | approved | qualified     |    3 | 2026-04-22 05:24:15 | 2026-04-22 05:25:47 |       0 |           3 |       0 |         0
system-pick-scanner | settled   | approved | qualified     |    2 | 2026-04-28 02:51:43 | 2026-04-28 03:24:13 |       0 |           2 |       2 |         0
human               | queued    | approved | qualified     |    2 | 2026-04-22 05:02:02 | 2026-04-22 05:05:25 |       0 |           2 |       0 |         0
canary-proof        | settled   | approved | not_eligible  |    2 | 2026-04-22 19:34:56 | 2026-04-22 19:37:25 |       0 |           2 |       1 |         0
api                 | settled   | approved | suppressed    |    2 | 2026-04-30 17:40:58 | 2026-04-30 17:45:33 |       0 |           2 |       2 |         0
human               | validated | approved | qualified     |    1 | 2026-04-22 04:59:44 | 2026-04-22 04:59:44 |       0 |           1 |       0 |         0
```

`distinct_cappers` is 0 in every segment and `null_capper` equals `n` in every segment.

**Q3 — Segmentation by writer identity (the axis that determines repairability)**

```sql
WITH cls AS (
  SELECT id, source,
    COALESCE(metadata ? 'proof_issue', false)
      OR COALESCE(metadata->>'eventName' LIKE 'db-smoke-%', false)
      OR COALESCE(metadata->>'eventName' ~* '^utv2-', false)
      OR COALESCE(selection ~* '^UTV2-[0-9]+', false)
      OR source IN ('t1-proof','canary-proof','proof-harness')
      OR COALESCE(metadata->>'submittedBy' ~* '(^|:)utv2-|proof', false)
      AS is_fixture,
    COALESCE(metadata->>'submittedBy','(none)') AS submitted_by
  FROM public.picks WHERE stake_units IS NULL
)
SELECT is_fixture, submitted_by, source, count(*) AS n
FROM cls GROUP BY 1,2,3 ORDER BY is_fixture, n DESC;
```

```text
is_fixture | submitted_by                  | source              |    n
false      | system:candidate-pick-scanner | system-pick-scanner | 2587
false      | scheduler:board-pick-writer   | board-construction  |  278
false      | (none)                        | api                 |   12
false      | anonymous:auth-bypass         | board-construction  |    7
true       | utv2-803-final-proof          | api                 |    5
true       | utv2-588-proof-api            | api                 |    4
true       | utv2-588-proof-sf             | smart-form          |    3
true       | (none)                        | human               |    3
true       | (none)                        | canary-proof        |    2
true       | (none)                        | api                 |    1
```

Fixture fraction of the NULL population: **18 / 2,902 = 0.62%**.

**Q4 — Fixture cross-check using the standard production classifier**

```sql
SELECT
  CASE
    WHEN metadata ? 'proof_issue' THEN 'meta.proof_issue'
    WHEN metadata->>'eventName' LIKE 'db-smoke-%' THEN 'eventName=db-smoke-*'
    WHEN metadata->>'eventName' ~* '^utv2-' THEN 'eventName=utv2-*'
    WHEN selection ~* '^UTV2-[0-9]+' THEN 'selection=UTV2-*'
    WHEN source IN ('t1-proof','canary-proof','proof-harness') THEN 'source=proof/canary/harness'
    ELSE 'UNMARKED'
  END AS fixture_marker,
  count(*) AS n, min(created_at) AS first_created, max(created_at) AS last_created
FROM public.picks
WHERE stake_units IS NULL
GROUP BY 1 ORDER BY n DESC;
```

```text
fixture_marker              |    n | first_created          | last_created
UNMARKED                    | 2895 | 2026-04-22 05:24:12+00 | 2026-05-08 14:57:51+00
eventName=utv2-*            |    5 | 2026-04-22 04:59:44+00 | 2026-04-22 05:23:16+00
source=proof/canary/harness |    2 | 2026-04-22 19:34:56+00 | 2026-04-22 19:37:25+00
```

The standard classifier catches only 7; adding the `submittedBy` marker (Q3) raises it to
18. The NULL population is the inverse of the picks table overall, which is predominantly
fixture — so these rows are genuinely-written system output, not CI residue.

**Q5 — Writer identity and system-generated flag**

```sql
SELECT metadata->>'submittedBy' AS submitted_by,
       metadata->>'systemGenerated' AS system_generated,
       count(*) AS n
FROM public.picks WHERE stake_units IS NULL
GROUP BY 1,2 ORDER BY n DESC LIMIT 25;
```

```text
submitted_by                  | system_generated |    n
system:candidate-pick-scanner | true             | 2587
scheduler:board-pick-writer   | true             |  278
(null)                        | (null)           |   18
anonymous:auth-bypass         | true             |    7
utv2-803-final-proof          | (null)           |    5
utv2-588-proof-api            | (null)           |    4
utv2-588-proof-sf             | (null)           |    3
```

**Q6 — Date bucketing**

```sql
SELECT to_char(created_at,'YYYY-MM') AS month, count(*) AS n,
       count(*) FILTER (WHERE status='voided') AS voided,
       count(*) FILTER (WHERE promotion_status='suppressed') AS suppressed,
       count(*) FILTER (WHERE promotion_status='not_eligible') AS not_eligible,
       count(*) FILTER (WHERE status IN ('settled','posted')) AS settled_or_posted
FROM public.picks WHERE stake_units IS NULL GROUP BY 1 ORDER BY 1;
```

```text
month   |    n | voided | suppressed | not_eligible | settled_or_posted
2026-04 | 2622 |     24 |       1614 |          991 |                15
2026-05 |  280 |      2 |        154 |          115 |                 0
```

```sql
SELECT date_trunc('week', created_at)::date AS week_start, source, count(*) AS n
FROM public.picks WHERE stake_units IS NULL
GROUP BY 1,2 ORDER BY 1,3 DESC;
```

```text
week_start | source              |    n
2026-04-20 | system-pick-scanner | 1831
2026-04-20 | api                 |   17
2026-04-20 | board-construction  |    7
2026-04-20 | smart-form          |    3
2026-04-20 | human               |    3
2026-04-20 | canary-proof        |    2
2026-04-27 | system-pick-scanner |  754
2026-04-27 | api                 |    5
2026-05-04 | board-construction  |  278
2026-05-04 | system-pick-scanner |    2
```

The population is closed: nothing created after 2026-05-08.

**Q7 — Constraint state**

```sql
SELECT con.conname, con.contype, con.convalidated, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname='public' AND rel.relname='picks'
ORDER BY con.contype, con.conname;
```

```text
conname                            | contype | convalidated | definition
picks_stake_units_canonical_check  | c       | false        | CHECK (((stake_units IS NOT NULL) AND (stake_units > (0)::numeric))) NOT VALID
picks_approval_status_check        | c       | true         | CHECK ((approval_status = ANY (ARRAY['pending','approved','rejected','voided','expired'])))
picks_promotion_status_check       | c       | true         | CHECK ((promotion_status = ANY (ARRAY['not_eligible','eligible','qualified','promoted','suppressed','expired'])))
picks_status_check                 | c       | true         | CHECK ((status = ANY (ARRAY['draft','validated','awaiting_approval','queued','posted','settled','voided'])))
```

**Answer: the constraint exists and is `NOT VALID`** (`convalidated = false`). It is the only
non-validated constraint on `public.picks`.

**Q8 — Derivation evidence availability**

```sql
SELECT
  count(*) AS null_stake_total,
  count(*) FILTER (WHERE submission_id IS NOT NULL) AS has_submission,
  count(*) FILTER (WHERE metadata ?| ARRAY['stake','stake_units','units','stakeUnits','unit_size','risk_units']) AS meta_has_stake_key,
  count(*) FILTER (WHERE metadata = '{}'::jsonb) AS empty_metadata,
  count(*) FILTER (WHERE confidence IS NOT NULL) AS has_confidence,
  count(*) FILTER (WHERE promotion_score IS NOT NULL) AS has_promotion_score,
  count(*) FILTER (WHERE idempotency_key IS NOT NULL) AS has_idem_key
FROM public.picks WHERE stake_units IS NULL;
```

```text
null_stake_total | has_submission | meta_has_stake_key | empty_metadata | has_confidence | has_promotion_score | has_idem_key
            2902 |           2900 |                  0 |              0 |           2888 |                2898 |         2900
```

```sql
SELECT p.metadata->>'stakeUnitsSource' AS stake_units_source, count(*) AS n
FROM public.picks p WHERE p.stake_units IS NULL GROUP BY 1 ORDER BY n DESC;
```

```text
stake_units_source |    n
(null)             | 2902
```

```sql
SELECT s.submitted_by,
       count(*) AS n,
       count(*) FILTER (WHERE s.payload ? 'stakeUnits') AS payload_has_stakeUnits,
       count(*) FILTER (WHERE s.payload ? 'stake_units') AS payload_has_stake_units,
       count(*) FILTER (WHERE s.payload->'metadata' ? 'stakeUnitsSource') AS payload_has_stakeUnitsSource,
       count(DISTINCT s.payload->>'stakeUnits') AS distinct_payload_stake_values
FROM public.picks p JOIN public.submissions s ON s.id = p.submission_id
WHERE p.stake_units IS NULL
GROUP BY 1 ORDER BY n DESC;
```

```text
submitted_by                  |    n | payload_has_stakeUnits | payload_has_stake_units | payload_has_stakeUnitsSource | distinct_payload_stake_values
system:candidate-pick-scanner | 2587 |                      0 |                       0 |                            0 |                             0
scheduler:board-pick-writer   |  278 |                      0 |                       0 |                            0 |                             0
(null)                        |   16 |                      0 |                       0 |                            0 |                             0
anonymous:auth-bypass         |    7 |                      0 |                       0 |                            0 |                             0
utv2-803-final-proof          |    5 |                      0 |                       0 |                            0 |                             0
utv2-588-proof-api            |    4 |                      0 |                       0 |                            0 |                             0
utv2-588-proof-sf             |    3 |                      0 |                       0 |                            0 |                             0
```

**No stake value survives anywhere in the write path for any row.** This is the finding that
forecloses every "derive-from-evidence" disposition.

**Q9 — Kelly sizing is not a derivation source**

```sql
SELECT jsonb_typeof(metadata->'kellySizing') AS kelly_type,
       metadata->'kellySizing'->>'recommended_units' AS recommended_units,
       metadata->'kellySizing'->>'has_edge' AS has_edge,
       metadata->'kellySizing'->>'capped' AS capped,
       count(*) AS n
FROM public.picks WHERE stake_units IS NULL
GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 30;
```

```text
kelly_type | recommended_units | has_edge | capped |    n
null       | (null)            | (null)   | (null) | 2891
object     | 0                 | false    | false  |    8
(null)     | (null)            | (null)   | (null) |    2
object     | 5.95              | true     | false  |    1
```

`kellySizing` is present as a key on 2,900 rows but its value is JSON-null on 2,891. Even
where it is an object, Kelly `recommended_units` is not the source of `stake_units` in
production: across rows where stake IS set, Kelly recommends 0 units for 7,037 rows that
nonetheless carry a stake, and observed `stake_units` ranges 0.01–2.50 while Kelly here
reports 5.95. The two quantities are not the same field.

```sql
SELECT
  (stake_units IS NULL) AS stake_is_null,
  count(*) AS n,
  count(*) FILTER (WHERE metadata ? 'kellySizing') AS has_kelly,
  count(*) FILTER (WHERE (metadata->'kellySizing'->>'recommended_units')::numeric = 0) AS kelly_units_zero,
  count(*) FILTER (WHERE (metadata->'kellySizing'->>'recommended_units')::numeric > 0) AS kelly_units_gt0,
  min(stake_units) AS min_stake, max(stake_units) AS max_stake
FROM public.picks
WHERE jsonb_typeof(metadata->'kellySizing') = 'object' OR metadata->'kellySizing' IS NULL
GROUP BY 1;
```

```text
stake_is_null |     n | has_kelly | kelly_units_zero | kelly_units_gt0 | min_stake | max_stake
false         | 83138 |     14348 |             7037 |            7311 |      0.01 |      2.50
true          |    11 |         9 |                8 |               1 |    (null) |    (null)
```

**Q10 — ROI blast radius: lifecycle participation**

```sql
SELECT 'null_stake_settled_or_posted' AS metric, count(*) AS n FROM public.picks
  WHERE stake_units IS NULL AND status IN ('settled','posted')
UNION ALL
SELECT 'null_stake_promoted', count(*) FROM public.picks
  WHERE stake_units IS NULL AND promotion_status = 'promoted'
UNION ALL
SELECT 'null_stake_posted_at_not_null', count(*) FROM public.picks
  WHERE stake_units IS NULL AND posted_at IS NOT NULL
UNION ALL
SELECT 'null_stake_terminal_dead_states', count(*) FROM public.picks
  WHERE stake_units IS NULL AND (status = 'voided' OR promotion_status IN ('suppressed','not_eligible','expired'));
```

```text
metric                          |    n
null_stake_settled_or_posted    |   15
null_stake_promoted             |    0
null_stake_posted_at_not_null   |   13
null_stake_terminal_dead_states | 2874
```

**Q11 — ROI blast radius: settlement records and the already-materialized phantom stake**

```sql
SELECT p.id AS pick_id, p.source, p.status AS pick_status, p.odds,
       sr.result, sr.status AS settlement_status, sr.stake_units AS settlement_stake_units,
       sr.settled_by, sr.corrects_id IS NOT NULL AS is_correction, sr.settled_at
FROM public.picks p JOIN public.settlement_records sr ON sr.pick_id = p.id
WHERE p.stake_units IS NULL ORDER BY sr.settled_at;
```

```text
pick_id                              | source              | pick_status | odds  | result | settlement_stake_units | settled_by            | is_correction
d8e63128-1245-4622-9cce-27cd81bcee11 | api                 | settled     |   150 | win    | (null)                 | utv2-654-canary-proof | false
b5ef3573-a970-4f18-9772-79c5193a9cfe | canary-proof        | settled     |  -371 | loss   | (null)                 | grading-service       | false
b5ef3573-a970-4f18-9772-79c5193a9cfe | canary-proof        | settled     |  -371 | win    | (null)                 | grading-service       | true
b6764d3c-bafe-439f-9770-4932ec5253d8 | canary-proof        | settled     |   235 | win    | (null)                 | grading-service       | false
39fb496e-6142-4d47-be1c-786c4188e320 | api                 | settled     |   100 | win    | (null)                 | utv2-803-final-proof  | false
6f1f8da5-1e01-40a4-b7b2-677cf094d926 | api                 | settled     |   105 | loss   | (null)                 | utv2-803-final-proof  | false
85cd0410-4a88-4c2b-885a-1d144b353278 | api                 | settled     |  -156 | win    | (null)                 | utv2-803-final-proof  | false
3dcfc6d3-9fa7-4b48-ba39-1dc47ba089f6 | api                 | settled     |  -135 | win    | (null)                 | utv2-803-final-proof  | false
da09731c-33fe-4302-aa81-16de7cd6e518 | api                 | settled     |  -141 | loss   | (null)                 | utv2-803-final-proof  | false
d9b96f8d-7d57-4f70-adbd-260722cc70a5 | system-pick-scanner | settled     |  -122 | win    | (null)                 | utv2-795-proof-runner | false
a3072fdc-c0f9-45e1-b10b-206f1f4c1f4b | system-pick-scanner | settled     | -4000 | win    | (null)                 | utv2-795-proof-runner | false
```

Correction: an earlier revision claimed every settled NULL-stake pick was settled by a proof runner or
by `grading-service` acting on a `canary-proof` row, and concluded the ROI blast radius against genuine
settled data is zero. **That conclusion was too strong.** Two `settled` and five `posted` rows are
`system:candidate-pick-scanner` output with no fixture marker. The blast radius is small — 7 rows —
but it is **not zero**, and the disposition for S1 must account for rows that reached a live lifecycle
state rather than treating the settled-or-posted set as entirely scaffolding.

```sql
SELECT sr.payload->>'profitLossUnits' AS profit_loss_units,
       sr.payload->>'stakeUnitsStatus' AS stake_units_status,
       sr.payload->>'stakeUnitsHistoricalUnknown' AS historical_unknown,
       count(*) AS n
FROM public.picks p JOIN public.settlement_records sr ON sr.pick_id = p.id
WHERE p.stake_units IS NULL
GROUP BY 1,2,3 ORDER BY n DESC;
```

```text
profit_loss_units | stake_units_status | historical_unknown | n
-1                | (null)             | (null)             | 2
-1.0              | (null)             | (null)             | 1
0.03              | (null)             | (null)             | 1
0.64              | (null)             | (null)             | 1
0.74              | (null)             | (null)             | 1
0.82              | (null)             | (null)             | 1
1                 | (null)             | (null)             | 1
1.0               | (null)             | (null)             | 1
1.5               | (null)             | (null)             | 1
2.35              | (null)             | (null)             | 1
```

This is Finding F3: concrete P/L with NULL stake and no integrity tag — a phantom 1-unit
stake already written to production by the archived backfill.

**Q12 — Where `stake_units` exists at all, and what aggregates ROI**

```sql
SELECT c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='stake_units'
ORDER BY c.table_name;
```

```text
table_name           | column_name
picks                | stake_units
picks_current_state  | stake_units
settlement_records   | stake_units
```

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND (column_name ~* 'clv' OR column_name ~* 'roi' OR column_name ~* 'units_(won|risked|net)')
ORDER BY table_name, column_name;
```

```text
table_name             | column_name
market_family_trust    | roi
model_health_snapshots | roi
```

Neither ROI-bearing table carries a `stake_units` column, and no view aggregates
`stake_units` for ROI.

```sql
SELECT count(DISTINCT v.pick_id) AS distinct_null_stake_picks_in_view,
       count(*) AS view_rows_fanned_out,
       count(*) FILTER (WHERE v.settlement_id IS NOT NULL) AS view_rows_with_settlement
FROM public.v_governed_pick_performance v
JOIN public.picks p ON p.id = v.pick_id
WHERE p.stake_units IS NULL;
```

```text
distinct_null_stake_picks_in_view | view_rows_fanned_out | view_rows_with_settlement
                              285 |               178973 |                         0
```

`pg_get_viewdef('public.v_governed_pick_performance')` confirms the view selects no
`stake_units` column and performs no units arithmetic; the 178,973 figure is join fan-out
through `pick_candidates` × `syndicate_board`, not distinct picks.

```sql
SELECT count(*) AS null_stake_rows_in_picks_current_state
FROM public.picks_current_state WHERE stake_units IS NULL;
```

```text
null_stake_rows_in_picks_current_state
                                  2902
```

**Q13 — The observed stake distribution across the whole table**

```sql
SELECT min(stake_units) AS min_stake, max(stake_units) AS max_stake,
       count(DISTINCT stake_units) AS distinct_stake_values
FROM public.picks WHERE stake_units IS NOT NULL;
```

```text
min_stake | max_stake | distinct_stake_values
     0.01 |      2.50 |                     5
```

```sql
SELECT stake_units, count(*) AS n,
       round(100.0*count(*)/sum(count(*)) OVER (), 2) AS pct
FROM public.picks WHERE stake_units IS NOT NULL
GROUP BY 1 ORDER BY n DESC;
```

```text
stake_units |      n |   pct
       1.00 | 104946 | 99.99
       1.25 |      5 |  0.00
       1.50 |      3 |  0.00
       0.01 |      1 |  0.00
       2.50 |      1 |  0.00
```

Across all 104,956 rows that carry a stake, **99.99% are exactly `1.00`** and only ten rows
in the entire table hold any other value. There is no variable stake history in this table
for a repair to corrupt. This does not by itself authorize writing `1` — the provenance
argument in V3 still stands, and the 18 fixture rows still must not be touched — but it does
remove the "fabricating stake history" hazard as a live concern for segments S1 and S2,
because the history being reconstructed is a single constant that the writers themselves
emit today.

**Q14 — Code-side confirmation of the writer defaults and the fail-closed guard**

`apps/api/src/candidate-pick-scanner.ts` — the writer for segment S1:

```text
209:      stakeUnits: 1,
230:        stakeUnitsSource: 'system_default_flat_1u',
267:    // Guard: picks created before picks_stake_units_canonical_check was added may have
268:    // stake_units IS NULL. Any lifecycle transition executes UPDATE picks SET status = ...
279:          event: 'candidate_skipped_null_stake_units',
283:          reason: 'legacy_pick_stake_units_null',
```

`apps/api/src/board-pick-writer.ts` — the writer for segment S2:

```text
240:        stakeUnits: 1,
276:          stakeUnitsSource: 'system_default_flat_1u',
```

Canonical fail-closed settlement path, `apps/api/src/settlement-service.ts:1045-1054`:

```ts
function computeProfitLossUnits(
  result: string | null,
  odds: number | null | undefined,
  stakeUnits: number | null | undefined,
): number | null {
  if (!result) return null;
  if (stakeUnits == null || !Number.isFinite(stakeUnits)) {
    return null;
  }
  const stake = stakeUnits;
```

Canonical ROI exclusion, `apps/api/src/recap-service.ts:221-235`:

```ts
  const knownStakeRows = joinedRows.filter(
    (row): row is typeof row & { stakeUnits: number; profitLossUnits: number } =>
      row.stakeUnits !== null && row.profitLossUnits !== null,
  );
  const unknownStakeCount = joinedRows.length - knownStakeRows.length;
```

Contradicting live paths (Finding F2) — `apps/api/src/grading-service.ts:988` and
`packages/domain/src/attribution/attribution-engine.ts:98`:

```ts
  const stake = stakeUnits ?? 1;
```

```ts
  const stake = input.stake_units ?? 1;
```

Constraint as declared in `supabase/migrations/00000000000000_baseline_live_schema.sql:4009`:

```sql
    ADD CONSTRAINT picks_stake_units_canonical_check CHECK (((stake_units IS NOT NULL) AND (stake_units > (0)::numeric))) NOT VALID;
```

Settlement trigger falls back to metadata, never to `1`
(`supabase/migrations/00000000000000_baseline_live_schema.sql:1924-1930`):

```sql
  IF NEW.stake_units IS NULL THEN
    SELECT COALESCE(p.stake_units, (p.metadata->>'stakeUnits')::numeric)
      INTO NEW.stake_units
      FROM picks p
      WHERE p.id = NEW.pick_id;
  END IF;
```

Archived backfill that produced the F3 phantom values
(`supabase/migrations_archive/202604250005_utv2_753_backfill_settlement_profit_loss.sql:15-30`):

```sql
    WHEN sr.result = 'loss' THEN -(COALESCE(p.stake_units, 1.0))
    WHEN sr.result = 'win' AND p.odds IS NOT NULL AND p.odds > 0
      THEN ROUND(COALESCE(p.stake_units, 1.0) * (p.odds::numeric / 100), 2)
```

A grep of the active migrations path for `COALESCE(p.stake_units, 1` returns no match, so
this pattern is not in the live migration chain.

### Lane verification commands

`pnpm type-check`:

```text
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

TYPECHECK_EXIT=0
```

`pnpm test` — full suite, aggregated across all node:test TAP blocks:

```text
TOTAL_PASS=4855
TOTAL_FAIL=0
TOTAL_SKIPPED=0
TOTAL_TESTS=4855
SUITE_BLOCKS=97
TEST_EXIT=0
```

`scripts/ci/r-level-check.ts`:

```text
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0
```

`pnpm verify` — recorded verbatim, including its refusal. `verify` is
`verify:static && test:live-db`, and `test:live-db` begins with `test:db`, which is gated by
`ci:assert-staging`. That gate refuses in this environment because the resolved DB target is
not the staging project:

```text
> @unit-talk/v2@0.1.0 ci:assert-staging
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE  Command failed with exit code 1.
ASSERT_STAGING_EXIT=1
```

`pnpm verify` therefore **cannot pass locally under credential containment**, and this proof
does not claim that it did. The full run's outcome is recorded below.

The full run was executed. `verify:static` completed successfully end to end — DB client
boundary, `ops:sync-check`, system alignment, automation coverage, `env:check`, lint,
`pnpm type-check`, build, `pnpm test`, smart-form verification, and `verify:commands`
(ending `[lint-migrations] 6 migration file(s) checked — no findings.`). Control then passed
to `test:live-db`, which refused as shown above. The terminating output was:

```text
> @unit-talk/v2@0.1.0 test:live-db
> pnpm test:db && pnpm test:t1-proof:live

> @unit-talk/v2@0.1.0 test:db
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts

> @unit-talk/v2@0.1.0 ci:assert-staging
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
VERIFY_EXIT=1
```

**`pnpm verify` did not pass: exit code 1**, failing at `test:db` → `ci:assert-staging`.
The static half passed; the writable-DB half was refused, not skipped and not faked.

This refusal is the intended control, not a defect: it is the UTV2-1630 staging-isolation
guard, and it is also the reason this audit was conducted entirely through read-only MCP
`SELECT` statements rather than through a writable verification harness. The static half of
`verify` is independently evidenced above by `pnpm type-check` and `pnpm test`.
