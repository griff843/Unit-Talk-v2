# PROOF: UTV2-1399 — reversible, fixture-excluding production reporting view

MERGE_SHA: PENDING_LANE_SLOT

> **Lane status: PREPARED, NOT STARTED.** `migration` is a singleton lane type
> and `["migration","runtime"]` is a forbidden combination in
> `docs/governance/CONCURRENCY_CONFIG.json`. UTV2-1604 is an active `runtime`
> lane (`status: in_review`, verified from its branch manifest). This lane was
> therefore NOT started and no PR was opened. Every measurement below is real
> and was taken read-only against production; only the lane slot is blocked.
> `MERGE_SHA` is bound post-merge by `post-merge-lane-close.yml` via
> `ops:proof-generate --merge-sha`.

## Verification

**Target:** production Supabase `zfzdnfwdarxucxtaojxm`
**Measured:** 2026-07-31 11:40:28 UTC → 12:0x UTC, all queries read-only (`SELECT` only)
**Method:** Supabase MCP `execute_sql`. No DDL was applied. No row was created,
updated or deleted by any step of this verification.

---

## ASSERTIONS:

- [x] The migration creates a reversible reporting surface using deterministic
      metadata markers, and excludes 100,278 conclusively marked fixture picks
      while retaining 7,580 legitimate picks (107,858 total — exhaustive and disjoint).
- [x] The migration performs **no** `DELETE`, `UPDATE`, `TRUNCATE`, `INSERT`,
      `ALTER TABLE` or `DROP COLUMN`. It is views-only. No base table is altered
      and no production row is mutated or removed. Enforced mechanically by
      `scripts/ci/utv2-1399-reporting-view-guard.test.ts`.
- [x] Reversibility: every created object lives in schema `reporting`;
      `DROP SCHEMA reporting CASCADE` restores prior reporting behaviour exactly.
      The down script exists and is not marked IRREVERSIBLE.
- [x] The classifier never keys on `source` alone. A naive source-based predicate
      was measured to wrongly exclude **6,462 of 7,580** real picks (85.2%).
- [x] False-positive check: the retained set contains the known-legitimate
      records, including real named-player picks from the same `smart-form` /
      `system-pick-scanner` / `api` sources that also produce fixtures.
- [x] The 411-row three-valued-logic defect documented in the cleanup packet is
      structurally impossible in this implementation (CASE returning a reason,
      filtered `IS NULL` / `IS NOT NULL`), and the migration aborts in-transaction
      if the partition is not exhaustive.

---

## EVIDENCE:

### 1. Classifier reconfirmed against current production data

The packet's validated classifier (`.out/fixture-cleanup-packet/classifier.sql`)
still reproduces its stated split exactly, 1 day after the census:

```sql
WITH f AS (
  SELECT id,
    COALESCE(
         (metadata ? 'proof_issue')
      OR (metadata->>'eventName' LIKE 'db-smoke-%')
      OR (metadata->>'eventName' ~* '^utv2-')
      OR (selection ~* '^UTV2-[0-9]+')
      OR (source IN ('t1-proof','canary-proof'))
    , false) AS is_fixture_v1,
    ((metadata ? 'proof_issue')
      OR (metadata->>'eventName' LIKE 'db-smoke-%')
      OR (metadata->>'eventName' ~* '^utv2-')
      OR (selection ~* '^UTV2-[0-9]+')
      OR (source IN ('t1-proof','canary-proof'))) AS raw_three_valued
  FROM public.picks
)
SELECT (SELECT count(*) FROM public.picks) AS total_picks,
       count(*) FILTER (WHERE is_fixture_v1)            AS fixture_v1,
       count(*) FILTER (WHERE NOT is_fixture_v1)        AS legitimate_v1,
       count(*) FILTER (WHERE raw_three_valued IS NULL) AS raw_predicate_null_rows,
       now() AS measured_at
FROM f;
```

```text
total_picks | fixture_v1 | legitimate_v1 | raw_predicate_null_rows | measured_at
------------+------------+---------------+-------------------------+------------------------------
     107858 |     100247 |          7611 |                     411 | 2026-07-31 11:40:28.899985+00
```

The packet's numbers hold. **The 411 `raw_predicate_null_rows` are the defect
the packet warned about**: `metadata->>'eventName'` is SQL NULL when the key is
absent, and `false OR NULL` is NULL, so a bare OR-chain predicate is
three-valued. `WHERE NOT (predicate)` would drop those 411 rows from *both* the
excluded and the retained set. This migration does not use an OR-chain
predicate — see §3.

### 2. Documented false-negative gap, closed

The packet (`false-positive-audit.md` §2b) records ~30 fixtures that *escaped*
into the legitimate bucket because `^UTV2-[0-9]+` and `^utv2-` both demand a
hyphen, and both are `^`-anchored. Measured: the widened predicate excludes
exactly **23** additional rows, and **every one carries an explicit UTV2 marker**.
Sampled output (23 of 23 inspected, not a sample):

```text
39fb496e | 26-04-30 | api        | settled   | Donovan Mitchell Over 6.5 (utv2-803-1777570768167)
da09731c | 26-04-30 | api        | settled   | Donovan Mitchell Under 6.5 (utv2-803-postbuild-1777571087125)
6f1f8da5 | 26-04-30 | api        | settled   | Evan Mobley Under 5.5 (utv2-803-1777570768167)
3dcfc6d3 | 26-04-30 | api        | settled   | Immanuel Quickley Over 1.5 (utv2-803-postbuild-...)
85cd0410 | 26-04-30 | api        | settled   | Jakob Poeltl Over 2.5 (utv2-803-1777570768167)
e1f121ee | 26-04-22 | api        | validated | LeBron James Over 24.5 [utv2-588-1776835452283]   proofRunId=true
947df253 | 26-04-22 | smart-form | validated | LeBron James Over 24.5 [utv2-588-1776835452283]   proofRunId=true
6bc79e8c | 26-05-29 | smart-form | settled   | UTV2 CLV Proof Player a5ea1262 Over 24.5   stake=1.00
e8c0d828 | 26-05-29 | smart-form | settled   | UTV2 CLV Proof Player f4e5d477 Over 24.5   stake=1.00
8ff6dd60 | 26-05-29 | smart-form | validated | UTV2 Proof Player af71fed8 Over 27.5       stake=1.00
   ... 13 further rows, all of the same two families
```

Two findings worth recording:

1. The `utv2-803` family uses **real player names on a real NBA event**
   (`Cleveland Cavaliers vs. Toronto Raptors`). Nothing but the explicit
   `(utv2-803-<runid>)` run tag distinguishes them from production rows — which
   is exactly why per-run tags, not content heuristics, are the right marker.
2. **`player_id` is not a realness signal.** `false-positive-audit.md` §1c used
   "has `player_id` populated" as structural counter-evidence for real picks
   (12 in the legitimate bucket, 0 in the fixture bucket). All 12 are in fact
   `UTV2 Proof Player` fixtures. After this classifier,
   `retained_with_player_id = 0`. The audit's conclusion was still correct; the
   supporting signal was not.

A further 8 rows carry non-CI but still non-production markers and are also
excluded: 5 `Command Center QA 202606` (submittedBy `codex-command-center-p…`),
1 `STAFF-ONLY DRY RUN`, 2 literal `selection='test'`.

### 3. Final classifier — measured excluded / retained / delta

Run with the classifier CASE inlined exactly as the migration defines it:

```sql
SELECT COALESCE(fixture_reason,'(RETAINED - legitimate)') AS reason,
       count(*) AS rows,
       count(*) FILTER (WHERE status='settled') AS settled,
       round(COALESCE(sum(stake_units) FILTER (WHERE status='settled'),0),2) AS settled_stake
FROM c GROUP BY ROLLUP (fixture_reason);
```

```text
reason                       |   rows | settled | settled_stake
-----------------------------+--------+---------+--------------
(TOTAL public.picks)         | 107858 |   18286 |      18278.00
(RETAINED - legitimate)      |   7580 |     387 |        385.50
utv2_selection_prefix        |  60208 |    7978 |       7978.00
proof_issue_metadata         |  19351 |       0 |          0.00
proof_only_source            |   8586 |    2147 |       2145.00
db_smoke_event               |   8100 |    7762 |       7762.00
utv2_event_name              |   4011 |       6 |          5.00
proof_run_id_metadata        |      9 |       1 |          2.50
command_center_qa            |      5 |       0 |          0.00
utv2_run_tag_selection       |      5 |       5 |          0.00
placeholder_selection        |      2 |       0 |          0.00
staff_only_dry_run           |      1 |       0 |          0.00
```

**Headline counts**

| Metric | Raw (`public.*`) | View (`reporting.*`) | Delta | Excluded |
|---|---:|---:|---:|---:|
| picks | 107,858 | 7,580 | −100,278 | 92.97% |
| submissions | 107,428 | 7,580 | −99,848 | 92.94% |
| settlement_records | 37,496 | 1,573 | −35,923 | 95.81% |
| settled stake (units) | 18,278.00 | 385.50 | −17,892.50 | 97.89% |

Partition is exhaustive and disjoint: 7,580 + 100,278 = 107,858 = `count(*) FROM public.picks`.

**ROI distortion, measured.** Reported performance is inflated by a factor of
**23.8× in settlement volume** and **47.4× in stake volume**:

```text
scope                             | settlements | wins  | losses | pushes | win_pct
----------------------------------+-------------+-------+--------+--------+--------
RAW  public.settlement_records    |       37496 | 22120 |  13614 |   1762 |   61.90
VIEW reporting.settlement_records |        1573 |   936 |    637 |      0 |   59.50
```

### 4. FALSE-POSITIVE CHECK (mandatory) — a naive predicate destroys the real data

The single most dangerous failure mode is classifying by `source`. `smart-form`,
`system-pick-scanner`, `model-driven`, `alert-agent` and `api` are all **both**
legitimate production source names **and** fixture source names.

```sql
SELECT (SELECT count(*) FROM c WHERE fixture_reason IS NULL
          AND source IN ('t1-proof','canary-proof','smart-form',
                         'system-pick-scanner','model-driven','alert-agent','api'))
         AS naive_source_would_wrongly_exclude,
       (SELECT count(*) FROM c WHERE fixture_reason IS NULL AND selection ILIKE '%utv2%')
         AS naive_substring_leftover,
       (SELECT count(*) FROM c WHERE fixture_reason IS NULL) AS retained_picks,
       (SELECT count(*) FROM c WHERE fixture_reason IS NULL
          AND metadata->>'eventName' ~ ' vs\. ') AS retained_with_real_event;
```

```text
naive_source_would_wrongly_exclude | naive_substring_leftover | retained_picks | retained_with_real_event
-----------------------------------+--------------------------+----------------+-------------------------
                              6462 |                        0 |           7580 |                     7180
```

**A naive source-based predicate would wrongly exclude 6,462 of the 7,580 real
picks — 85.2% of the entire legitimate dataset.** This classifier retains all
of them.

**Concrete legitimate records a naive predicate destroys and this view retains**
— all settled, all real matchups, all from dual-use sources:

```text
a122bcca | 26-06-29 | system-pick-scanner | settled | under      | Los Angeles Dodgers vs. San Diego Padres | player_batting_total_bases_ou | 1.00
d9b96f8d | 26-04-28 | system-pick-scanner | settled | over       | Vegas Golden Knights vs. Utah Mammoth    | player_hockey_points_ou       | null
a3072fdc | 26-04-28 | system-pick-scanner | settled | under      | Tampa Bay Rays vs. Cleveland Guardians   | player_batting_doubles_ou     | null
26e4adb9 | 26-04-28 | system-pick-scanner | settled | over       | Oklahoma City Thunder vs. Phoenix Suns   | player_rebounds_ou            | 1.00
22d89bb7 | 26-04-21 | smart-form          | settled | Cavaliers  | Toronto Raptors vs. Cleveland Cavaliers  | moneyline                     | 1.00
```

`naive_substring_leftover = 0` confirms the complementary direction: no row
containing `utv2` anywhere in `selection` survives into `reporting.picks`.

7,180 of 7,580 retained picks (94.7%) carry a real `<team> vs. <team>` event
name; only **6** excluded rows do, and all 6 are the accounted-for `utv2-803`
and `canary-proof` families.

### 5. View bodies executed read-only against production

Each view's defining query was run verbatim (classifier inlined, since
`reporting.pick_fixture_reason` does not exist on live yet):

```text
picks_raw | picks_retained | picks_excluded | submissions_raw | submissions_retained
   107858 |           7580 |         100278 |          107428 |                 7580

settlements_raw | settlements_retained | settled_stake_raw | settled_stake_retained
          37496 |                 1573 |          18278.00 |                 385.50
```

Cross-check on the submissions partition — no submission straddles the boundary:

```text
subs_with_retained_pick | subs_with_fixture_pick | subs_mixed_BOTH_sides | retained_picks_without_submission
                   7580 |                  92518 |                     0 |                                0
```

### 6. Reversibility

No base table is touched. Every object is created inside schema `reporting`:
one `IMMUTABLE` classifier function and five views (`picks`, `excluded_picks`,
`submissions`, `settlement_records`, `contamination_summary`).

`db/migrations-rollback/20260731000000_utv2_1399_fixture_excluding_reporting_views.down.sql`
drops that schema and nothing else, after a fail-closed guard that aborts if any
object outside `reporting` has come to depend on it. The migration is genuinely
reversible and therefore correctly **absent** from
`irreversible-exemption-registry.json`.

`reporting.excluded_picks` is the deliberate audit counterpart: every excluded
row remains fully present in `public.picks` and is listed with the reason it was
excluded. **Nothing is deleted. No exact-ID deletion packet is executed or
implied by this lane.**

### 7. Static verification

```text
$ npx tsx --test scripts/ci/utv2-1399-reporting-view-guard.test.ts
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 810.149062

$ npx eslint scripts/ci/utv2-1399-reporting-view-guard.test.ts scripts/generate-types.mjs
=== ESLINT EXIT: 0 ===

$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
=== TYPECHECK EXIT: 0 ===

$ pnpm test:ops          # full ops suite, with the new guard wired in
# tests 1497
# suites 6
# pass 1497
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 51294.532839
=== EXIT: 0 ===

$ npx tsx scripts/ci/migration-reversibility-gate.ts --base origin/main
  [PASS] supabase/migrations/20260731000000_utv2_1399_fixture_excluding_reporting_views.sql
migration-reversibility-gate: PASS
=== GATE EXIT: 0 ===
```

### 8. Generated types

`scripts/generate-types.mjs` hardcoded `--schema public` in all three credential
branches, so `reporting.*` would never have appeared in
`packages/db/src/database.types.ts` and every consumer would have kept reading
the contaminated `public.*` tables. Changed to a single `TYPED_SCHEMAS =
'public,reporting'` constant. Adding a schema is additive to the generated
`Database` type, so existing `Database['public'][...]` consumers are unaffected
(`pnpm type-check` PASS above).

**`packages/db/src/database.types.ts` is deliberately NOT regenerated in this
commit.** `pnpm supabase:types` generates from the **live** database, and the
migration is not on live until it merges. Regenerating now would (a) not contain
the `reporting` schema at all, and (b) sweep in unrelated live drift — the
ledger-orphaned `command_center_game_threads` and
`command_center_delivery_mappings` tables (see §9) — polluting this lane's diff
with DDL it does not own. Regeneration is a **post-merge closeout step**, in the
same class as proof SHA binding.

### 9. Adjacent finding — Live Schema Parity drift (recorded, not fixed)

`Live Schema Parity` fails repo-wide with 78 unauthorized `missing_in_expected`
findings. Investigated read-only:

- **Cause.** `scripts/ops/compare-databases.ts` diffs the live database against
  the repo migrations *replayed from scratch*. `missing_in_expected` means
  "present in live, absent from the repo ledger". `command_center_game_threads`
  and `command_center_delivery_mappings` exist on live but have **no CREATE
  TABLE anywhere** in `supabase/migrations/`, `supabase/migrations_archive/`,
  the baseline dump, or `db/migrations-rollback/`. They are entirely absent —
  not present-but-drifted. Created out-of-band after the UTV2-1274 baseline.
- **The 78:** 2 relations + 43 columns + 14 constraints + 17 indexes + 2 triggers.
- **Safely repairable: yes.** A pure additive ledger repair — one forward
  migration with the two `CREATE TABLE`s, their constraints, indexes, RLS enable
  and `set_updated_at` triggers, plus a matching `.down.sql`. ~120–180 lines,
  zero live DDL (it only teaches the replay what live already has). A baseline
  re-dump would also work but has a much larger blast radius: it would silently
  absorb any *other* unaudited live drift.
- **Does it block this lane? No.** Branch protection
  (`repos/griff843/Unit-Talk-v2/branches/main/protection`) requires exactly
  `["verify","Executor Result Validation","Merge Gate","P0 Protocol"]`; rulesets
  are empty. `Live Schema Parity` is advisory. Furthermore the comparison is
  **hard-scoped to `public`** (`--schema public`, single-schema snapshot SQL) and
  never inspects `pg_proc`, so a `reporting` schema containing only views and a
  function introduces **zero** new parity findings in either direction.
- **One trap to avoid:** the lane manifest must **not** set
  `runtime_proof_kind: live-schema-parity`. That field makes
  `t1-proof-gate.yml` and `proof-auditor-gate.yml` call
  `assert-live-schema-parity-pass.ts`, which would fail closed on these 78
  pre-existing findings. It is the UTV2-1274 schema-only exception and does not
  apply here; this lane proves via `pnpm test:db`.

Recommend a separate `migration` lane for the repair. **Not expanded into this
lane** — it is unrelated DDL and would make this diff non-reviewable.

### 10. Grant statement UTV2-1633 will need

The views are intentionally **not** created `WITH (security_invoker = true)`.
`public.picks`, `public.submissions` and `public.settlement_records` all have
RLS enabled and are owned by `postgres`, so security-definer views let a
consumer read the reporting surface **without holding any grant on the base
tables** — which is precisely the least-privilege property UTV2-1633 needs.

UTV2-1399 grants nothing. UTV2-1633 needs exactly:

```sql
GRANT USAGE ON SCHEMA reporting TO <readonly_role>;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO <readonly_role>;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO <readonly_role>;
```

`GRANT SELECT ON ALL TABLES` covers views; the `ALTER DEFAULT PRIVILEGES` line
makes any future reporting view readable without a follow-up grant. The role
must **not** be granted anything on `public`, or it regains a path to the
contaminated tables and the whole surface is pointless.

### 11. Not closed in this lane

- `pnpm test:db` (T1 requirement) — not run. It requires an active lane and runs
  against staging `xskgrzbteyqdufktjrjx` via `pnpm ci:assert-staging`.
- Round-trip reversibility drill — runs in CI
  (`migration-reversibility-gate.yml`, scratch `postgres:16`). No Docker or
  `psql` is available locally, so it could not be executed here. The migration
  was written for it: the partition guard is conditioned on `v_raw > 0` so a
  replay against an empty database does not abort.
- `packages/db/src/database.types.ts` regeneration — post-merge, per §8.

### 12. Lane apparatus — ready to use the moment the slot frees

`ops:lane-start UTV2-1399` was deliberately NOT run. Note that it would have
been *mechanically admitted*: `scripts/ops/shared.ts readAllManifests()` reads
only the local `docs/06_status/lanes/*.json`, and UTV2-1604's manifest exists
only on its own PR branch, so the governor would have seen no `runtime` lane and
raised no `forbidden_combination` violation. Admission by that loophole would
still have violated the rule, so the lane was not started. (Four of the six
active worktrees — UTV2-1594, 1613, 1624, 1632 — likewise have no committed
manifest, so the governor is blind to most of the live board. Recommend
resolving active lanes from open PRs rather than the local working tree.)

**Unblock condition:** UTV2-1604 reaches `done` (PR #1319 merged and its lane
closed). Then `ops:lane-start UTV2-1399` is admissible with no config change.

Exact `file_scope_lock` for the manifest (`lane_type: migration`, `tier: T1`,
`executor: claude`) — every file this lane creates or modifies:

```json
[
  "supabase/migrations/20260731000000_utv2_1399_fixture_excluding_reporting_views.sql",
  "db/migrations-rollback/20260731000000_utv2_1399_fixture_excluding_reporting_views.down.sql",
  "scripts/ci/utv2-1399-reporting-view-guard.test.ts",
  "scripts/generate-types.mjs",
  "packages/db/src/database.types.ts",
  "package.json",
  ".lane/migration-lock.yml",
  ".ops/sync/UTV2-1399.yml",
  "docs/06_status/lanes/UTV2-1399.json",
  "docs/06_status/proof/UTV2-1399/**"
]
```

`expected_proof_paths`: `docs/06_status/proof/UTV2-1399/verification.md`,
`docs/06_status/proof/UTV2-1399/evidence.json`.

Do **not** set `runtime_proof_kind: live-schema-parity` (see §9).

`.lane/migration-lock.yml` currently holds a **stale** lock naming
`issue_id: UTV2-1086` with `release_after: merge`, acquired 2026-05-24 — that
migration merged long ago and the lock was never released.
`scripts/lane-contract.ts` only checks the file *exists*, not that it matches
the current lane, so the stale lock neither blocks nor protects anything. It
should be re-claimed for UTV2-1399 as part of lane-start.

**Remaining steps once started:** claim the migration lock → `pnpm verify` →
`pnpm test:db` → open PR → four required contexts green → `pm-verdict/v1`
APPROVED + `t1-approved` → merge via REST (never `--admin`) → migration applied
to live → `pnpm supabase:types` → `ops:lane-finalize` → `ops:lane-close`.
