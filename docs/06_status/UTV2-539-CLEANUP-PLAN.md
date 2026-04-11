# UTV2-539 — DEBT-002 stranded `awaiting_approval` cleanup plan

| Field | Value |
|---|---|
| Linear issue | UTV2-539 |
| Debt register entry | DEBT-002 (`docs/06_status/KNOWN_DEBT.md`) |
| Parent incident | `docs/06_status/INCIDENTS/INC-2026-04-10-utv2-519-awaiting-approval-constraint-gap.md` |
| Delegation tier | Tier C / T1 sensitive-path — production row mutation |
| This document | PLAN + EXECUTE wiring. Live mutation is gated and PM-witnessed. |
| Status | Plan accepted; execute-path PR pending PM merge |
| Supabase project ref | `feownrheeefbcsehtsiw` |
| Dry-run evidence | `evidence/utv2-539-dry-run-fresh.json` |
| Cleanup script | `apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts` |
| Backfill RPC migration | `supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql` |

---

## §1 Re-verified live inventory

Fresh live-DB query executed against `feownrheeefbcsehtsiw` at
**2026-04-11T16:41:34.918Z**. The script is read-only; the run captured
`SELECT ... FROM picks WHERE status='awaiting_approval'` plus a batched
`SELECT pick_id FROM pick_lifecycle WHERE to_state='awaiting_approval' AND pick_id IN (...)`.
A "stranded" row is any `picks` row in `awaiting_approval` whose `id` does
not appear in the returned `pick_lifecycle` set.

**Stranded totals (fresh, live):**

| Metric | Plan target (baseline) | Fresh actual | Drift |
|---|---|---|---|
| Total stranded | 24 | **24** | none |
| `system-pick-scanner` | 20 | **20** | none |
| `alert-agent` | 2 | **2** | none |
| `model-driven` | 2 | **2** | none |

The fresh counts match the DEBT-002 baseline exactly. Raw query used by the
script (conceptually — see script for exact REST form):

```sql
-- (1) stranded picks
SELECT id, status, source, selection, approval_status, created_at, metadata
FROM picks
WHERE status = 'awaiting_approval';

-- (2) lifecycle rows hitting the same target state (batched, IN list)
SELECT pick_id, to_state
FROM pick_lifecycle
WHERE to_state = 'awaiting_approval'
  AND pick_id IN (...stranded pick ids...);
```

Evidence: `evidence/utv2-539-dry-run-fresh.json` — full machine-readable
report including every row, its classification, and its reason string.

---

## §2 Classification framework

Each stranded row is assigned to exactly one of three buckets by the
dry-run script's `classifyRow()` function. The rules are evaluated in order;
the first match wins.

### Rule A — `fixture` (proof-run artifact)

At least one of the following must hold:

1. `metadata.proof_script` is present and a string
2. `metadata.proof_fixture_id` is present and a string
3. `metadata.test_key` is present and a string
4. `selection` matches `/utv2-494|lane-c|fresh\s*proof/i`

**Intent:** detect rows authored by the UTV2-494 Phase 7A proof scripts
(Lane A `utv2-494-phase7a-proof-a-brake.ts`, Lane C
`utv2-494-phase7a-proof-c-review.ts`) and the ad-hoc fresh-proof test row.
Those rows are not real picks; they are proof-run artifacts that hit the
non-atomic `transitionPickLifecycle` bug and got stranded mid-write.

**Planned action:** DELETE (in the follow-up exec PR, after PM approval).

### Rule B — `production-backfill` (legitimate scanner submission)

All of the following must hold:

1. `source = 'system-pick-scanner'`
2. `metadata.systemGenerated === true`
3. `metadata.idempotencyKey` is a string that starts with `system-pick:sgo:`

**Intent:** detect real scanner submissions issued against the live SGO
feed during the pre-UTV2-519 window. These are structurally legitimate
picks. Deleting them would silently erase `system-pick-scanner` activity
from the audit record.

**Planned action:** BACKFILL (in the follow-up exec PR). Specifically:

- INSERT a `pick_lifecycle` row with
  `pick_id = <row>`,
  `from_state = 'validated'` (or `NULL` if the chain never advanced),
  `to_state = 'awaiting_approval'`,
  `reason` noting `UTV2-539 DEBT-002 backfill — pre-UTV2-519 constraint gap`,
  `created_at` = original pick `created_at` (so the chain is monotonically
  consistent with the original submission window)
- INSERT the sibling `audit_log` row with `entity_ref = pick id` and an
  `action` string such as `lifecycle.backfill.awaiting_approval`
- DO NOT mutate the `picks` row itself. Its `status` is already
  `awaiting_approval`; the backfill only makes the chain consistent.

### Rule C — `unclassified`

Any stranded row that matches neither A nor B. If any such row exists, the
dry-run script reports them and the exec wiring MUST NOT proceed until they
are resolved manually.

### Current classification table (24 rows)

| # | pick_id | source | classification | reason |
|---|---|---|---|---|
| 1 | `0f7aa2e3-…313a` | system-pick-scanner | production-backfill | scanner systemGenerated=true idempotencyKey=system-pick:sgo:…:BROOKS_LEE_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 2 | `918c9e99-…fcd1` | system-pick-scanner | production-backfill | …:BYRON_BUXTON_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 3 | `1e3ae402-…42e6` | system-pick-scanner | production-backfill | …:RYAN_JEFFERS_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 4 | `9c1f021e-…38ad` | system-pick-scanner | production-backfill | …:JOSHUA_BELL_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 5 | `10dea854-…77d6` | system-pick-scanner | production-backfill | …:LUKE_KEASCHALL_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 6 | `7eb84cb4-…f167` | system-pick-scanner | production-backfill | …:MATT_WALLNER_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 7 | `61acebaf-…aa2a` | system-pick-scanner | production-backfill | …:BROOKS_LEE_1_MLB:batting_hits+runs+rbi-all-game-ou:under |
| 8 | `a40437d1-…751e` | system-pick-scanner | production-backfill | …:ROYCE_LEWIS_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 9 | `a36c3936-…f3c8` | system-pick-scanner | production-backfill | …:VICTOR_CARATINI_1_MLB:batting_basesOnBalls-all-game-ou:under |
| 10 | `ee74a2c7-…014d` | system-pick-scanner | production-backfill | …:AUSTIN_MARTIN_1_MLB:batting_hits+runs+rbi-all-game-ou:under |
| 11 | `272e05da-…2b85` | system-pick-scanner | fixture | metadata.proof_fixture_id=utv2-494-lane-a-system-pick-scanner-1775854552811 |
| 12 | `6e479bd8-…47ed` | alert-agent | fixture | metadata.proof_fixture_id=utv2-494-lane-a-alert-agent-1775854554562 |
| 13 | `ed0fed89-…5666` | system-pick-scanner | production-backfill | …:LUKE_KEASCHALL_1_MLB:batting_hits+runs+rbi-all-game-ou:over |
| 14 | `82d6ae62-…724e` | system-pick-scanner | production-backfill | …:JOSHUA_BELL_1_MLB:batting_hits+runs+rbi-all-game-ou:under |
| 15 | `41d8298f-…26d3` | model-driven | fixture | metadata.proof_fixture_id=utv2-494-lane-a-model-driven-1775854555962 |
| 16 | `8bc07735-…0abd` | system-pick-scanner | production-backfill | …:BYRON_BUXTON_1_MLB:batting_hits+runs+rbi-all-game-ou:under |
| 17 | `fba43b6a-…4b8c` | system-pick-scanner | production-backfill | …:MATT_WALLNER_1_MLB:batting_hits+runs+rbi-all-game-ou:under |
| 18 | `07f74718-…1398` | system-pick-scanner | production-backfill | …:VICTOR_CARATINI_1_MLB:batting_hits+runs+rbi-all-game-ou:over |
| 19 | `6c9cceab-…5dd9` | system-pick-scanner | production-backfill | …:ROYCE_LEWIS_1_MLB:batting_hits+runs+rbi-all-game-ou:under |
| 20 | `5f73230c-…2754` | system-pick-scanner | fixture | metadata.proof_script=utv2-494-lane-c (approve case) |
| 21 | `826343db-…7a41f` | alert-agent | fixture | metadata.proof_script=utv2-494-lane-c (deny case) |
| 22 | `7cabee61-…c695` | system-pick-scanner | production-backfill | …:RYAN_JEFFERS_1_MLB:batting_hits+runs+rbi-all-game-ou:over |
| 23 | `0466af23-…c337` | model-driven | fixture | metadata.proof_script=utv2-494-lane-c (hold case) |
| 24 | `a046dad7-…d41b` | system-pick-scanner | fixture | metadata.test_key=abc-1775854761 (Fresh Proof UTV2-494 Test) |

**Counts:** 7 fixture, 17 production-backfill, **0 unclassified**.

The production-backfill set is exactly the 17 scanner submissions generated
during the live scanner window of 2026-04-10T20:52:33Z..20:57:17Z before
`SYSTEM_PICK_SCANNER_ENABLED` was flipped to `false`. The fixture set is
exactly the 7 UTV2-494 Phase 7A Lane A + Lane C + fresh-proof artifacts
that hit the constraint gap during proof runs.

---

## §3 Planned actions per classification

The follow-up exec PR will ship one migration and one wiring change to the
dry-run script. **This pass does NOT ship either.**

### 3.1 Fixture rows (7)

Action: **DELETE**.

Steps (inside a single transaction in the exec migration):

```sql
-- Structural cleanup: rows that were never real picks.
DELETE FROM picks WHERE id IN (<7 fixture ids>) AND status = 'awaiting_approval';
```

Rollback hook: a pre-DELETE `SELECT INTO TEMP TABLE debt002_fixture_backup AS ...`
dumped to `evidence/utv2-539-exec-fixture-backup.json` before the DELETE
runs. The follow-up PR ships the dump wiring; this PR does not.

### 3.2 Production-backfill rows (17)

Action: **BACKFILL lifecycle + audit chain**. DO NOT touch the `picks` row.

For each row, inside a single transaction:

```sql
INSERT INTO pick_lifecycle (pick_id, from_state, to_state, reason, created_at, actor)
VALUES (<id>, 'validated', 'awaiting_approval',
        'UTV2-539 DEBT-002 backfill — pre-UTV2-519 constraint gap',
        <original picks.created_at>, 'system:utv2-539-backfill');

INSERT INTO audit_log (entity_type, entity_id, entity_ref, action, actor, created_at, payload)
VALUES ('pick_lifecycle', <new lifecycle row id>, <pick id text>,
        'lifecycle.backfill.awaiting_approval', 'system:utv2-539-backfill',
        <now>, jsonb_build_object(
          'reason', 'UTV2-539 DEBT-002 backfill',
          'previousLifecycleState', 'validated',
          'newLifecycleState', 'awaiting_approval',
          'note', 'pre-UTV2-519 non-atomic transitionPickLifecycle stranded row'));
```

The exact `from_state` value for each pick must be verified from the
previous lifecycle row (if any) by the exec script before it runs. If a
stranded pick has no prior lifecycle row at all, `from_state` will be NULL.

### 3.3 Unclassified rows (0)

No action required in this pass. If future re-runs surface unclassified
rows, the dry-run script will block plan generation until they are
resolved.

---

## §4 Cleanup script command reference

The cleanup script is `apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts`.
The matching backfill RPC migration is
`supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql`.

```bash
# Human-readable dry-run (default, read-only)
UNIT_TALK_APP_ENV=local \
  npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts

# Machine-readable JSON dry-run (read-only).
# Captured as evidence/utv2-539-dry-run-fresh.json by the plan-pass run;
# do not overwrite that artifact — write a new path for re-runs.
UNIT_TALK_APP_ENV=local \
  npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --json \
  > evidence/utv2-539-dry-run-pre-exec.json

# Execute path — performs production mutation. Requires BOTH env gates to
# be set AND --execute on the CLI AND UTV2_539_DRY_RUN_ONLY must NOT be set.
# Output is captured to evidence/utv2-539-execute-run.log for the PM
# witness record.
UNIT_TALK_APP_ENV=local \
UTV2_539_PM_APPROVED=1 UTV2_539_EXECUTE_CONFIRMED=yes \
  npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --execute \
  2>&1 | tee evidence/utv2-539-execute-run.log

# Refusal: --execute without env gates exits 2 with a "REFUSING to execute"
# message and never touches the live DB.
npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --execute
# -> exit 2

# Downgrade guard: forces --execute back to dry-run regardless of env gates.
UTV2_539_DRY_RUN_ONLY=1 UTV2_539_PM_APPROVED=1 UTV2_539_EXECUTE_CONFIRMED=yes \
  npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --execute
# -> dry-run, exit 0
```

Required env gates for `--execute` (all three must be set, AND
`UTV2_539_DRY_RUN_ONLY` must NOT be set, AND `--execute` must be passed):

- `--execute` CLI flag
- `UTV2_539_PM_APPROVED=1`
- `UTV2_539_EXECUTE_CONFIRMED=yes`

Drift guard: `actualStrandedTotal` is compared against `PLAN_TARGET_TOTAL`
(24) and every row is compared against `PLAN_TARGET_BY_SOURCE`. Any drift
surfaces in `report.drift_notes` and the execute path refuses to mutate
when `drift_detected === true`, exiting with `process.exitCode = 1` and
`failedAt = 'inventory_drift: ...'` in the summary JSON.

Per-row drift is also enforced inside the execute path:

- The fixture-DELETE loop filters every `picks` DELETE on
  `status='awaiting_approval'`. A zero-row match aborts the loop with
  `failedAt='fixture_drift: ...'` before any further writes happen.
- An intermediate checkpoint between the fixture and backfill phases
  re-queries the stranded set and verifies every backfill target is still
  stranded as `production-backfill`. Any drift aborts before any RPC call.
- The backfill RPC itself (`backfill_pick_awaiting_approval`) raises
  `INVALID_BACKFILL_STATE` (SQLSTATE P0001) if the row is no longer
  `awaiting_approval` and `ALREADY_BACKFILLED` if a prior
  `to_state='awaiting_approval'` lifecycle row already exists.

---

## §5 Post-execution verification queries

After the exec PR runs (future work — NOT this pass), the following
verification queries must return zero for each stranded bucket.

```sql
-- Must return 0 — no stranded picks remain
SELECT COUNT(*) FROM picks p
WHERE p.status = 'awaiting_approval'
  AND NOT EXISTS (
    SELECT 1 FROM pick_lifecycle l
    WHERE l.pick_id = p.id AND l.to_state = 'awaiting_approval'
  );

-- Must equal 17 — one backfilled lifecycle row per production-backfill pick
SELECT COUNT(*) FROM pick_lifecycle
WHERE to_state = 'awaiting_approval'
  AND reason LIKE 'UTV2-539 DEBT-002 backfill%';

-- Must equal 17 — one audit row per backfilled lifecycle row
SELECT COUNT(*) FROM audit_log
WHERE action = 'lifecycle.backfill.awaiting_approval'
  AND payload->>'reason' = 'UTV2-539 DEBT-002 backfill';

-- Must equal 0 — no surviving fixture rows
SELECT COUNT(*) FROM picks
WHERE id IN (<7 fixture ids>);
```

---

## §6 Rollback notes

### Data-level rollback

- **Production backfill (RPC) writes** are fully reversible. The RPC
  `public.backfill_pick_awaiting_approval` writes exactly two rows per
  invocation: one `pick_lifecycle` row tagged
  `reason='backfill_utv2_519_remediation'` and one `audit_log` row tagged
  `action='pick.governance_brake.backfilled'` with
  `payload->>'linear_issue' = 'UTV2-539'`. Both can be removed exactly:

  ```sql
  -- Run the audit_log delete FIRST so we don't leave audit rows whose
  -- entity_id points at a pick_lifecycle row that no longer exists.
  DELETE FROM public.audit_log
   WHERE action = 'pick.governance_brake.backfilled'
     AND payload->>'linear_issue' = 'UTV2-539';

  DELETE FROM public.pick_lifecycle
   WHERE reason = 'backfill_utv2_519_remediation';
  ```

  The `picks` rows are never touched by the backfill (the row was already
  in `awaiting_approval`), so there is nothing to roll back on that table.

- **Fixture DELETEs are NOT rollback-able.** The 7 fixture rows have no
  pre-snapshot in this PR. They are proof-script artifacts authored by
  UTV2-494 Phase 7A Lane A / Lane C / fresh-proof runs and have no
  legitimate downstream value. The intentional design is that the fixture
  delete is a clean structural removal: there is no scenario in which the
  proof-script artifacts need to be re-hydrated. If a future regression
  requires equivalent fixtures, re-run the proof scripts (which will
  generate fresh ones with new ids).

- **Fixture deletes ordering is intentional.** The execute path deletes
  `audit_log` (`promotion.suppressed` rows tied to the pick) → then
  `pick_lifecycle` (the prior `validated` row) → then `picks`. The picks
  delete carries `status='eq.awaiting_approval'` as a drift guard.

### RPC-level rollback

```sql
DROP FUNCTION IF EXISTS public.backfill_pick_awaiting_approval(uuid, text);
```

This is safe to run AFTER the data-level rollback above. Running the
function drop without first removing the audit_log + pick_lifecycle rows
would leave audit rows whose `payload->>'linear_issue'` references a
function that no longer exists — that's not a constraint violation but
it confuses post-mortem queries.

### Migration-level rollback

The migration file is
`supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql`.
To revert:

1. Run the data-level rollback SQL above (audit_log first, then
   pick_lifecycle).
2. Run the RPC-level rollback above (`DROP FUNCTION`).
3. `git revert` the commit that added the migration file. This removes
   the file from `supabase/migrations/` so future
   `pnpm supabase:types` and CI lint passes do not see a deleted RPC.

The ordering matters: revert the data first (so no orphan audit rows
reference a missing function), drop the function second, then revert the
migration file at the repo level.

### File-level rollback (this PR)

- This PR adds one migration
  (`supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql`),
  modifies one script
  (`apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts`), and
  modifies this plan doc. Reverting the PR removes the migration and
  reverts the script + doc to the plan-pass state. Nothing in the live
  DB is affected by such a revert until the migration is applied AND the
  cleanup script is run with `--execute` and both env gates set.

---

## §7 Findings for PM

1. **Live count matches baseline exactly.** 24 stranded rows, 20/2/2
   across scanner/alert-agent/model-driven. No drift from the KNOWN_DEBT.md
   DEBT-002 snapshot. The quiesce of `SYSTEM_PICK_SCANNER_ENABLED=false`
   since 2026-04-10T21:15Z has held — no new stranded rows have accumulated.

2. **Classification is clean.** 0 unclassified rows. Every row is either a
   proof-run artifact (7 rows tied to UTV2-494 Lane A/Lane C/fresh-proof) or
   a legitimate scanner submission (17 rows with valid
   `system-pick:sgo:…` idempotency keys). The split is unambiguous.

3. **Production-backfill set is authentically production.** The 17
   scanner rows span a ~5-minute live scanner window
   (20:52:33Z..20:57:17Z on 2026-04-10), targeting 9 distinct MLB players
   across `batting_basesOnBalls-all-game-ou` and
   `batting_hits+runs+rbi-all-game-ou` markets with valid idempotency
   keys. These are not test rows. Deleting them would erase real
   `system-pick-scanner` activity from the audit record — the plan
   therefore BACKFILLS rather than DELETEs.

4. **Fixture set is authentically test-only.** The 7 fixture rows carry
   explicit `metadata.proof_script`, `metadata.proof_fixture_id`, or
   `metadata.test_key` markers authored by UTV2-494 Phase 7A Lane A and
   Lane C proof scripts. They have no legitimate downstream value and
   are safe to DELETE.

5. **No exec wiring in this PR.** The `--execute` path is a hard stub
   that exits 2. A follow-up PR (branch/tag `UTV2-539-exec`) will wire
   the mutation path, ship a guard migration-equivalent SQL block, and
   record post-exec verification queries. This PR's only purpose is to
   produce a re-verified plan for PM ratification.

6. **Drift guard is in place.** The script compares live counts to
   `PLAN_TARGET_TOTAL=24` and `PLAN_TARGET_BY_SOURCE={scanner:20,
   alert-agent:2, model-driven:2}`. Any deviation becomes a hard gate
   in the exec pass and exits the script before mutation can begin.

---

## §8 Dual-step operational sequence

The cleanup ships in two distinct, separately-witnessed steps. They MAY
be combined inside a single PM session (window permitting), but they
MUST NOT be combined inside a single PR. Migration apply and live data
mutation are separate operational acts.

### Step 1 — execute-path PR (this PR)

- Adds the backfill RPC migration
  (`supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql`)
- Wires the execute path into the cleanup script
  (`apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts`)
- Updates this plan doc (§4 / §6 / §9)
- Tier C / T1 sensitive-path merge touchpoint — PM approval required to
  merge per the canonical delegation policy
  (`docs/05_operations/DELEGATION_POLICY.md`)
- **Does NOT apply the migration to live DB**
- **Does NOT run `--execute` against live DB**
- The PR is mergeable as soon as PM has reviewed the diff and approved
  the migration text + execute-path implementation. Live mutation is a
  separate witnessed action (Step 2).

### Step 2 — PM-witnessed live mutation pass

After this PR merges, in a single PM-witnessed session:

1. Apply the migration to the live DB (`feownrheeefbcsehtsiw`) using the
   project's standard migration apply path. The migration is purely
   additive (creates one PL/pgSQL function + one grant) and does not
   touch any existing row.
2. Capture a fresh dry-run snapshot for the pre-mutation record:
   ```bash
   UNIT_TALK_APP_ENV=local \
     npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --json \
     > evidence/utv2-539-dry-run-pre-exec.json
   ```
   This MUST report `actual_stranded_total = 24`, `counts.fixture = 7`,
   `counts.productionBackfill = 17`, `counts.unclassified = 0`,
   `drift_detected = false`. If any of these is false, STOP.
3. Run the cleanup script ONCE with both env gates set, capturing the
   full output to `evidence/utv2-539-execute-run.log`:
   ```bash
   UNIT_TALK_APP_ENV=local \
   UTV2_539_PM_APPROVED=1 UTV2_539_EXECUTE_CONFIRMED=yes \
     npx tsx apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts --execute \
     2>&1 | tee evidence/utv2-539-execute-run.log
   ```
4. Run the four §5 verification queries against the live DB. The first
   must return 0 (no stranded picks remain), queries 2 and 3 must return
   17 (one backfill row + one audit row per production-backfill pick),
   query 4 must return 0 (no surviving fixture rows).
5. Attach `evidence/utv2-539-execute-run.log` and the four query results
   to the Linear issue (UTV2-539). Move the issue to Done. Update
   `docs/06_status/KNOWN_DEBT.md` DEBT-002 to closed.

If any step fails, STOP. The script exits 1 on partial failure and emits
a `failedAt` field in the JSON summary identifying the exact phase. The
fixture-DELETE phase has no rollback (see §6); the production-backfill
phase is fully reversible via the §6 data-level rollback SQL.

**Combining steps in a single session is explicitly allowed but not
required.** PM decides based on window availability. Dispatching
migration apply and live data mutation inside the same PR is explicitly
forbidden — they must be separately witnessed actions.

---

## §9 Ready-for-review sign-off

> **PM sign-off required here.** Leave this block blank. Filled after
> plan review.

- [ ] Plan accepted as written (§3 actions approved for exec wiring)
- [ ] Plan accepted with modifications (list modifications below)
- [ ] Plan rejected (reason below)

Notes / modifications from PM:

```
(empty — to be filled by PM)
```

Signed: _______________________   Date: _______________________
