# Model Ownership Persistence Standard

**Issue:** UTV2-853  
**Status:** Governance standard — pre-implementation  
**Author:** Claude — 2026-05-07  
**Depends on:** UTV2-847, UTV2-848, UTV2-849, UTV2-850 — all must be on `main`  
**Scope:** Defines the runtime ownership persistence contract — where ownership originates, how it propagates, what fields are required, and runtime enforcement semantics. No migrations or runtime code changes in this pass.

---

## Verified pre-conditions from implementation passes

| Finding | Value | Source |
|---|---|---|
| model_attributed_pct | **0%** across 4,202 picks | UTV2-850 pass |
| model_registry entries | **6 entries, all `champion`** | UTV2-850 pass |
| Sports covered in registry | MLB, NBA, NHL | UTV2-850 pass |
| Market families covered | game_line, player_prop | UTV2-850 pass |
| pick_candidates.model_score | **Exists and populated** | UTV2-850 pass |
| pick_candidates.model_tier | **Exists and populated** | UTV2-850 pass |
| pick_candidates.model_confidence | **Exists and populated** | UTV2-850 pass |
| pick_candidates.model_registry_id | **Does not exist** | UTV2-850 pass |
| picks.source check constraint | **Exists** | UTV2-849 pass |
| heuristic_pct of inventory | 90.03% | UTV2-849 pass |
| model_edge_contamination_pct | 100% | UTV2-849 pass |

### The exact gap

Scoring already runs. The system writes `model_score`, `model_tier`, and `model_confidence` to `pick_candidates` at candidate evaluation time. The 6 champion registry entries exist and cover the sports and market families where picks are being produced.

The gap is a single missing write: **`pick_candidates.model_registry_id` is never set at the time `model_score` is written.**

Every other ownership problem downstream — 0% model attribution, invalid model-edge evaluation, impossible champion/challenger comparison — traces to this one missing write. The governance stack (847–850) defines what must be true. UTV2-853 defines how to make it durably true at runtime.

---

## 1. Purpose

Ownership persistence exists to make one guarantee hold at every point in a pick's lifecycle:

> **"The intelligence entity that produced this pick is permanently, unambiguously, and immutably recorded from the moment of scoring through settlement and reporting."**

Without persistent ownership, the 6 registered champion models are bookkeeping entries — they exist in the registry but are not connected to any picks. The scoring output (`model_score`, `model_tier`, `model_confidence`) exists on candidates but cannot be attributed to any specific model. This is not a documentation gap. It is an analytical dead end.

### Why ownership must be persistent, not reconstructed

Ownership must be written at the moment of scoring and carried forward. It cannot be inferred, reconstructed, or assigned after the fact because:

1. **Models change.** A `system-pick-scanner` pick scored in week 1 may have been produced by a different champion model than one scored in week 8. Without a timestamped registry FK, these are indistinguishable.

2. **Scores are not unique identifiers.** Two models can produce the same `model_score` for different reasons. Score values do not identify the model that produced them.

3. **Retroactive assignment is fabrication.** Assigning historical picks to a registry entry based on temporal overlap is not provenance — it is invention. The standard forbids it.

4. **Calibration requires pick-level attribution.** You cannot calibrate a model if you cannot identify which predictions belonged to it.

### What fails without persistent ownership

| Analytical requirement | Failure mode without ownership |
|---|---|
| Model-edge evaluation | Cannot attribute picks to a specific model; edge claim is invalid |
| Champion/challenger comparison | Cannot separate champion picks from challenger picks |
| Calibration and Brier score | Cannot match predicted probability to pick-level result |
| Model drift detection | Cannot compute per-model performance time series |
| Syndicate-readiness evidence | Cannot prove model attribution for any pick |
| CLV attribution | Cannot separate model CLV from heuristic CLV |
| Rollback confidence | Cannot verify which picks were produced by the rolled-back model |

### Explicit statements

A heuristic system is not a model. Assigning picks to a model registry entry does not change their nature — it records which entity made the scoring decision. If the entity that scored a candidate is a heuristic rule, the registry entry for that entity must have `registry_entity_type = heuristic_system`.

Without persistent ownership at the candidate level, model-edge evaluation is invalid. Not imprecise — invalid.

---

## 2. Ownership Persistence Contract

### 2.1 Where ownership originates

Ownership originates at **candidate scoring** — the moment when a `pick_candidates` row receives a `model_score`, `model_tier`, and `model_confidence` value.

This is the single, authoritative write point for model ownership. Everything downstream is a propagation of ownership from this moment.

Currently, candidate scoring writes three fields to `pick_candidates`:
- `pick_candidates.model_score`
- `pick_candidates.model_tier`
- `pick_candidates.model_confidence`

The ownership persistence contract requires a fourth field to be written atomically with those three:
- `pick_candidates.model_registry_id` → FK → `model_registry.id`

**Atomically** means in the same database transaction. Writing `model_score` without writing `model_registry_id` in the same transaction is not permitted under this contract.

### 2.2 Where ownership is stored

| Entity | Storage mechanism | When written |
|---|---|---|
| `pick_candidates` | `model_registry_id` FK (new column) | At candidate scoring, atomically with `model_score` |
| `picks` | Via join: `picks` → `pick_candidates` (via `pick_candidates.pick_id`) → `model_registry` | Derived; no direct column needed |
| `distribution_outbox` | Via join: `distribution_outbox.pick_id` → `picks.id` → `pick_candidates` → `model_registry` | Derived |
| `settlement_records` | Via join: `settlement_records.pick_id` → `picks.id` → `pick_candidates` → `model_registry` | Derived |
| CLV computation | Via join through `picks` → `pick_candidates` → `model_registry` | Derived at CLV query time |
| Recap/reporting | Via join from reporting query | Derived at reporting time |

**The core principle: ownership is written once (on `pick_candidates`) and joined everywhere else.** Duplicating `model_registry_id` across `picks`, `settlement_records`, and `distribution_outbox` would create consistency risks — two sources of truth can diverge. One write, many reads via join.

### 2.3 Where ownership is immutable

Once `pick_candidates.model_registry_id` is set and the candidate has been converted to a pick (`pick_candidates.pick_id` is non-null), ownership is immutable. It cannot be changed.

Immutability is enforced by:
1. Not exposing `model_registry_id` as an updateable field in any write API
2. Making the column non-nullable once set (the write path sets it; no update path exists)
3. Audit logging any attempt to update the value

Before `pick_candidates.pick_id` is set (i.e., the candidate has not yet been converted), the candidate is not yet a production pick. Corrections to `model_registry_id` before conversion are permitted but must be logged.

### 2.4 Where ownership propagates

Ownership is not copied — it propagates via joins. Every system that needs to know which model produced a pick must resolve the join chain:

```
picks.id
  → pick_candidates.pick_id   (find the candidate)
  → pick_candidates.model_registry_id   (find the registry entry)
  → model_registry.*   (read model identity and state)
```

This join chain is the single source of truth for model ownership. Any report or analytical query that bypasses this chain and uses `picks.source` alone is not performing model attribution.

### 2.5 Ownership for non-model picks

| Pick origin | Ownership behavior |
|---|---|
| `smart-form` / `human` / `api` | No `pick_candidates` row; no `model_registry_id`; ownership is NONE (manual_strategy entity type) |
| `system-pick-scanner` without registry FK | `pick_candidates` row exists but `model_registry_id` is null; ownership is UNKNOWN |
| `system-pick-scanner` with registry FK | `pick_candidates.model_registry_id` is non-null; ownership is the linked entity |
| `board-construction` | Same rules as `system-pick-scanner` |
| `canary-proof` | `synthetic_model` entity type; registry entry exists if synthetic entity is registered; excluded from production analytics |

---

## 3. Required Ownership Fields

### 3.1 Core ownership fields (on `pick_candidates`)

| Field | Type | Status | Immutable after conversion | Model-edge req. | Notes |
|---|---|---|---|---|---|
| `model_registry_id` | uuid | **New — migration required** | Yes | Yes | FK → `model_registry.id`; written atomically with `model_score` |
| `model_score` | numeric | Exists | Yes | Yes | Already populated |
| `model_tier` | text | Exists | Yes | Yes | Already populated |
| `model_confidence` | numeric | Exists | Yes | Yes | Already populated |
| `scan_run_id` | text | Exists | Yes | Yes | Already populated; links to scoring run context |
| `shadow_mode` | boolean | Exists | Yes | Yes | Already populated |
| `is_board_candidate` | boolean | Exists | Yes | No | Already populated |

### 3.2 Additional ownership fields (on `pick_candidates`, new)

| Field | Type | Required | Immutable | Model-edge req. | Notes |
|---|---|---|---|---|---|
| `scoring_run_id` | uuid | Required for model_generated | Yes | Yes | FK → `system_runs.id`; identifies which specific system run performed the scoring. May be the same as or derived from `scan_run_id` — Codex must verify. |
| `feature_snapshot_id` | uuid | Optional (future) | Yes | Syndicate only | FK → future feature snapshot table; not required for initial ownership enforcement |
| `ownership_timestamp` | timestamptz | Required | Yes | Yes | The exact timestamp when `model_registry_id` was written. Derived from transaction time if not explicit. |

### 3.3 Fields required on `model_registry` (not currently present)

The UTV2-850 pass confirmed these columns are missing from `model_registry`:

| Field | Type | Required by 853 | Notes |
|---|---|---|---|
| `registry_entity_type` | text | Yes — hard requirement | Distinguishes `champion_model` from `heuristic_system`; currently all 6 entries have no entity type column |
| `source_type_compatibility` | text[] | Yes | Which `picks.source` values this entity owns |
| `owner` | text | Yes | Responsible team or individual |
| `training_window_start` | timestamptz | Required for model entities | Not required for heuristic_system |
| `training_window_end` | timestamptz | Required for model entities | Not required for heuristic_system |
| `validation_metrics` | jsonb | Required for champion | Snapshot at promotion time |
| `calibration_metadata` | jsonb | Required for champion | |
| `promotion_approved_by` | text | Required for champion | |
| `promotion_approved_at` | timestamptz | Required for champion | |

The 6 existing registry entries lack all of these. This is a schema gap that must be addressed in the implementation lane. **The governance standard defines what must exist; the migration adds it.**

### 3.4 Field immutability rules

| Field | Before pick conversion | After pick conversion |
|---|---|---|
| `pick_candidates.model_registry_id` | Correctable with logged reason | Immutable |
| `pick_candidates.model_score` | Correctable | Immutable |
| `pick_candidates.ownership_timestamp` | Set by system at write time | Immutable |
| `pick_candidates.scoring_run_id` | Set at scoring time | Immutable |
| `model_registry.registry_entity_type` | Mutable while in `draft` | Immutable once `champion` |
| `model_registry.validation_metrics` | Mutable before promotion | Immutable snapshot after promotion |
| `model_registry.training_window_*` | Mutable while in `draft`/`validated` | Immutable once `shadow` |

---

## 4. Ownership Lifecycle

### 4.1 Full lifecycle with ownership at each stage

```
[Candidate Scoring]
  pick_candidates.model_score       ← written by scanner
  pick_candidates.model_tier        ← written by scanner
  pick_candidates.model_confidence  ← written by scanner
  pick_candidates.model_registry_id ← MUST be written atomically (currently MISSING)
  pick_candidates.scoring_run_id    ← MUST be written atomically (currently MISSING)
  pick_candidates.ownership_timestamp ← MUST be written atomically (currently MISSING)
  pick_candidates.scan_run_id       ← already written
        │
        ▼
[Board Construction / Candidate Selection]
  pick_candidates.is_board_candidate ← already set
  pick_candidates.pick_id            ← set when candidate converts to pick
  Ownership: inherited via pick_candidates.model_registry_id (no new write)
        │
        ▼
[Pick Creation]
  picks.id                   ← created
  picks.source               ← set at creation (enforced by check constraint)
  picks.stake_units          ← set at creation (enforced by UTV2-845)
  picks.status = 'draft'     ← initial state
  Ownership: resolved via JOIN picks.id → pick_candidates.pick_id → model_registry_id
  (No model_registry_id column needed directly on picks)
        │
        ▼
[Pick Qualification / Approval]
  picks.approval_status = 'approved'
  picks.status → 'validated' or 'queued'
  Ownership: unchanged; join chain still valid
        │
        ▼
[Pick Posting]
  picks.posted_at   ← set
  picks.status = 'posted'
  picks.source: IMMUTABLE after posting (enforced per UTV2-848)
  Ownership: IMMUTABLE after posting (pick_candidates.model_registry_id frozen)
        │
        ▼
[Distribution]
  distribution_outbox.pick_id  ← FK to picks
  Ownership: resolved via pick_id → picks → pick_candidates → model_registry_id
        │
        ▼
[Settlement]
  settlement_records.pick_id   ← FK to picks
  Ownership: resolved via same join chain
  settlement_records.source    ← settlement data source (separate from pick ownership)
        │
        ▼
[CLV Computation]
  Join: picks → pick_candidates → model_registry → registry entity type
  Join: picks → market key → provider_offers (is_closing = true)
  Only model_generated entity types are included in model CLV samples
        │
        ▼
[Recap / Reporting]
  All reporting resolves ownership via the join chain
  No ownership is stored in recap tables — all derived at query time
```

### 4.2 Ownership must never disappear

If at any stage in the lifecycle the join chain `picks.id → pick_candidates.pick_id → model_registry_id` cannot be resolved, the pick's ownership is UNKNOWN at that stage. This is not an acceptable production state for picks created after UTV2-853 enforcement goes live.

A pick that loses its candidate link (e.g., `pick_candidates` row is deleted) permanently loses ownership visibility. `pick_candidates` rows must never be deleted for picks that are in `posted`, `settled`, or beyond.

### 4.3 Ownership cannot silently downgrade

A pick attributed to a `champion_model` at scoring time remains attributed to that entity even if the model is later retired or disabled. The ownership records what was true at scoring time, not what is true now. This is intentional:

- Retirement analysis requires knowing which picks the retired model produced.
- Rollback analysis requires knowing which picks were produced during the failure window.
- Model drift analysis requires a continuous time series — gaps caused by retroactive attribution changes break the series.

### 4.4 Operator edits preserve original ownership lineage

If an operator modifies a pick's odds, line, or selection after creation:
- `picks.source` becomes `operator_edited` (per UTV2-848)
- `picks.metadata.original_source` preserves the pre-edit value
- `pick_candidates.model_registry_id` is **not changed** — the original scoring decision is preserved

The pick's ownership remains with the model that scored the candidate. The operator's edit is recorded as a post-hoc modification, not as a new scoring decision. For model-edge evaluation, operator-edited picks are excluded (per UTV2-849) but the ownership record remains intact for audit purposes.

---

## 5. Runtime Enforcement Semantics

### 5.1 Hard-fail conditions (enforced at write time)

| Condition | Enforcement action |
|---|---|
| Candidate scoring writes `model_score` without writing `model_registry_id` in the same transaction | Fail the transaction. Do not commit partial ownership. |
| `model_registry_id` references a registry entry that does not exist | Fail with FK violation. |
| `model_registry_id` references a `disabled` or `retired` registry entry at scoring time | Reject. A disabled or retired model must not score new candidates. |
| `picks.source` set to a value not in the check constraint set | Reject at DB level (check constraint enforces this) |
| `pick_candidates.pick_id` set but `model_registry_id` is null for a non-manual-strategy pick | Reject pick conversion. Log provenance failure. |

### 5.2 Quarantine conditions (pick proceeds, excluded from model-edge)

| Condition | Enforcement action |
|---|---|
| `pick_candidates.model_registry_id` is null for a pick created after enforcement boundary | Quarantine from model-edge analytics. Allow operational processing. Count in attribution gaps. |
| `model_registry_id` references a `degraded` registry entry | Allow pick. Flag as `degraded-model-pick`. Include in degradation monitoring. Exclude from syndicate. |
| `picks.source` is `system-pick-scanner` but `pick_candidates` join returns no row | Quarantine. Log missing candidate. Classify as UNKNOWN ownership. |
| Candidate `shadow_mode = true` but pick enters `distribution_outbox` | Block distribution. Shadow picks must not be posted. |

### 5.3 Warn-only conditions

| Condition | Enforcement action |
|---|---|
| `model_registry.registry_entity_type` column does not exist (pre-migration state) | Warn. Classify all registry entries as UNKNOWN entity type. Do not fail scoring. |
| `scoring_run_id` is null (not yet implemented) | Warn. Record in schema_gaps. Do not fail scoring. |
| `model_registry_id` references a `challenger_model` entry | Warn. Label pick as challenger. Include in challenger evaluation plane, not champion plane. |
| `ownership_timestamp` is null (not yet implemented) | Warn. Use `pick_candidates.created_at` as proxy. |

### 5.4 Enforcement boundary

The enforcement boundary is the moment UTV2-853 goes live in production. Picks created before this boundary are subject to the historical policy (§6). Picks created after this boundary must satisfy all hard-fail conditions.

The boundary timestamp must be recorded in a system configuration or migration record so that historical vs post-enforcement picks can be distinguished in all future queries.

---

## 6. Historical Policy

### 6.1 All 4,202 existing picks are permanently UNKNOWN for model ownership

This is a fixed fact, not a temporary state. The 6 registered champion models exist, but no pick in the database has ever had `pick_candidates.model_registry_id` set — because the column does not exist. There is no evidence chain that links any historical pick to any specific registry entry.

Historical picks remain in the `UNKNOWN` ownership category permanently. They are:
- Visible in all aggregate counts
- Counted in `model-attribution-gaps.csv`
- Included in heuristic ROI and production-readiness reporting (with WARN caveat)
- Excluded from model-edge evaluation permanently

### 6.2 No retroactive ownership assignment

The 6 champion models cover MLB, NBA, NHL across game_line and player_prop. The 3,622 `system-pick-scanner` picks were scored during the period when some or all of these models were in `champion` state. It is tempting to assign those picks to the appropriate champion model based on sport + market_family + date range.

**This is forbidden.** The reasons:

1. A champion model at a given date is not proven to have scored a specific candidate. The scanner may use a different scoring path than the registry tracks.
2. Two registry entries may cover overlapping scopes during a transition period.
3. Temporal inference is not provenance. The standard defines provenance as a direct, written record — not a reconstruction.
4. If the attribution is wrong, future model evaluation is permanently contaminated with false positives.

### 6.3 What is permitted for historical rows

| Action | Permitted |
|---|---|
| Classify by entity type using `picks.source` → §2.1 mapping | Yes (read-only) |
| Count historical UNKNOWN rows by sport and market family | Yes |
| Compute heuristic ROI and CLV for `system-pick-scanner` historical picks | Yes (with WARN caveat) |
| Report the temporal gap between scanner activity and registry existence | Yes |
| Use historical picks as a baseline to compare against post-enforcement picks | Yes |

### 6.4 Small clean attributed sample outweighs large contaminated sample

The correct interpretation of the post-enforcement world:

> "We have N picks with verified model ownership from [enforcement date] onward. We have 4,202 historical picks with UNKNOWN ownership. Model-edge evaluation uses only the N verified picks. The historical 4,202 contribute to heuristic analytics only."

When N is small (early in enforcement), model-edge conclusions will have wide confidence intervals or be INSUFFICIENT. That is correct. Wide confidence intervals from real data are more valuable than narrow confidence intervals from fabricated attribution.

---

## 7. Relationship to Existing Governance

The governance chain is ordered and each layer depends on the one before:

| Standard | What it defines | What 853 depends on |
|---|---|---|
| UTV2-847 | Evidence truthworthiness scoring — can we trust the evidence? | 853 produces picks whose truthworthiness will be evaluated by 847's scoring framework |
| UTV2-848 | Provenance contract — where did a pick come from? | 853 requires a candidate link to exist before ownership can be assigned |
| UTV2-849 | Source separation — what type of entity produced the pick? | 853 writes the FK that makes `model_generated` classification real, not inferred |
| UTV2-850 | Registry semantics — what fields must the registry have? | 853 defines how the registry entries are linked to candidates at runtime |
| **UTV2-853** | **Runtime persistence — how does ownership survive the lifecycle?** | This standard |

The dependency is strict. UTV2-853 cannot be implemented before UTV2-850's schema additions are in place. Specifically:
- `model_registry.registry_entity_type` must exist before scoring code can write the correct entity type
- `model_registry` must have `source_type_compatibility` before the scanner can look up which registry entry to use

### Upgrade path

After UTV2-853 enforcement goes live:

1. The scanner looks up the correct `model_registry.id` for the current sport + market_family scope before scoring
2. It writes `pick_candidates.model_registry_id` atomically with `model_score`
3. All downstream joins resolve ownership via this FK
4. UTV2-847's `model-attributed` dimension starts returning non-zero percentages
5. UTV2-849's `model_only_pct` grows as post-enforcement picks accumulate
6. UTV2-850's champion/challenger evaluation becomes possible once sufficient post-enforcement sample exists

---

## 8. Future Implications

### 8.1 Real model-generated inventory

After UTV2-853 goes live, new picks from `system-pick-scanner` will be:
- Classified as `model_generated` (if `model_registry_id` is set and entity type is champion/challenger/shadow)
- Included in model-edge evaluation samples
- Contributing to per-model CLV and ROI time series

The inventory shifts from 0% model-attributed to some positive percentage — initially small, growing as post-enforcement picks accumulate.

### 8.2 Champion/challenger evaluation

Two champion entries for different scopes (e.g., NBA game_line and MLB player_prop) can now be evaluated independently:
- Per-model ROI, CLV, Brier score
- Per-model drawdown
- Per-model win rate by market family

Challenger evaluation becomes real when a second registry entry exists for the same scope with `registry_entity_type = challenger_model`. Its picks are labeled, tracked separately, and evaluated against the champion.

### 8.3 Calibration and drift analysis

Calibration requires: for each model_confidence value (predicted win probability), what is the actual win rate across settled picks?

This is only possible with per-model pick attribution. After 853:
- Query: all settled picks where `pick_candidates.model_registry_id = [specific model]`
- Group by `model_confidence` bucket
- Compute actual win rate per bucket
- Compare to predicted probability

Drift detection is the same query run as a time series.

### 8.4 Syndicate-readiness evidence

Syndicate-readiness requires all 15 UTV2-847 dimensions to be PASS. The `model-attributed` dimension currently fails for 100% of picks. After 853:
- New picks accumulate with verified model attribution
- `model-attributed` dimension becomes evaluable on the post-enforcement sample
- Syndicate-readiness evidence becomes possible once the post-enforcement sample is large enough

### 8.5 What 853 does NOT fix

| Remaining gap | Resolution |
|---|---|
| Historical 4,202 picks remain UNKNOWN | Permanent; no fix |
| `model_registry` missing several required fields | UTV2-850 implementation lane must add them |
| Unsupported markets in scoring output | UTV2-851 (quarantine standard) must address this |
| CLV computation for model picks | Depends on provider freshness and UTV2-847 CLV-backed dimension |
| Minimum sample size for model-edge conclusions | Post-enforcement accumulation; no shortcut |

---

## 9. Codex Implementation Packet

**Dispatch condition:** UTV2-850 must be merged on `main`. The following schema additions from UTV2-850 must also be in place before 853 Codex dispatch:
1. `model_registry.registry_entity_type` column exists
2. `model_registry.source_type_compatibility` column exists

If these columns do not exist, the 853 implementation lane cannot proceed — the scanner cannot determine which registry entry to write without them.

**This is an investigation + migration-planning pass.** Codex must:
1. Verify schema state
2. Find the candidate scoring write path in code
3. Produce a concrete migration plan
4. Produce the proof artifacts

**Codex must NOT add the migration itself in this pass.** The migration requires operator approval. Codex identifies the migration and the write-path insertion point; the operator approves.

---

```
Issue: UTV2-853 — Model Ownership Persistence Runtime Contract
Branch: codex/utv2-853-ownership-persistence-contract
Depends on: UTV2-850 merged on main, AND model_registry.registry_entity_type column exists

## Task

Implement a read-only investigation + proof/report script that:
1. Verifies the current schema state of candidate scoring write paths
2. Locates the code path where pick_candidates.model_score is written
3. Documents the exact insertion point for model_registry_id
4. Identifies the minimal migration set required
5. Produces machine-readable ownership gap artifacts

Do NOT add any migration.
Do NOT write to pick_candidates, model_registry, or picks.
Do NOT fabricate ownership attribution.
Do NOT assign historical picks to registry entries.

## Entry point

scripts/ownership-persistence/run-ownership-report.ts

Run as: npx tsx scripts/ownership-persistence/run-ownership-report.ts
Optional flag: --days 30 (evaluation window, default 30)

## Step 1 — Schema verification

Verify pick_candidates columns:

  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'pick_candidates'
  ORDER BY column_name;

Verify model_registry columns (especially post-850 additions):

  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'model_registry'
  ORDER BY column_name;

Check for existing FK from pick_candidates to model_registry:

  SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'pick_candidates';

Check model_registry for source_type_compatibility column and registry_entity_type:

  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'model_registry'
    AND column_name IN ('registry_entity_type', 'source_type_compatibility', 'owner',
                        'training_window_start', 'training_window_end',
                        'validation_metrics', 'calibration_metadata',
                        'promotion_approved_by', 'promotion_approved_at');

Check picks.source check constraint details:

  SELECT conname, pg_get_constraintdef(oid) as definition
  FROM pg_constraint
  WHERE conrelid = 'picks'::regclass AND contype = 'c';

## Step 2 — Code path investigation (read-only file search)

Find where pick_candidates.model_score is written in the codebase:

  Search for: model_score
  File types: .ts, .sql
  Locations: apps/, packages/, scripts/, supabase/

  For each match, determine:
  - Is this a write (INSERT or UPDATE)?
  - What other fields are written in the same statement?
  - Is model_registry_id written in the same transaction?
  - What function/method is this in?
  - What triggers this function (scheduler, API, etc.)?

Record the findings as code_path_findings in the output JSON.

Search for scan_run_id writes:

  Search for: scan_run_id
  File types: .ts, .sql

Search for system-pick-scanner origin:

  Search for: system-pick-scanner
  File types: .ts, .sql

## Step 3 — Ownership gap quantification (read-only queries)

Gap 1: picks without candidate link (manual/submission only):

  SELECT COUNT(*) as count
  FROM picks
  WHERE id NOT IN (
    SELECT pick_id FROM pick_candidates WHERE pick_id IS NOT NULL
  )
  AND created_at > NOW() - INTERVAL '30 days';

Gap 2: picks WITH candidate link but candidate has no model_registry_id:

  SELECT COUNT(*) as count
  FROM picks p
  JOIN pick_candidates pc ON pc.pick_id = p.id
  WHERE (pc.model_registry_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'pick_candidates'
           AND column_name = 'model_registry_id'
         ))
  AND p.created_at > NOW() - INTERVAL '30 days';

  Note: If model_registry_id column does not exist, ALL candidate-linked
  picks fall into this gap. Record both the column existence and the count.

Gap 3: model_registry entries missing registry_entity_type:

  SELECT COUNT(*) as count
  FROM model_registry
  WHERE registry_entity_type IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'model_registry'
       AND column_name = 'registry_entity_type'
     );

## Step 4 — Migration plan documentation

Produce a concrete migration plan in ownership-migration-plan.json.
Do NOT execute any migration. Define what would be needed:

Required migration 1 (pick_candidates FK):
  ALTER TABLE pick_candidates
  ADD COLUMN model_registry_id UUID REFERENCES model_registry(id),
  ADD COLUMN scoring_run_id UUID REFERENCES system_runs(id),
  ADD COLUMN ownership_timestamp TIMESTAMPTZ;

  Note: model_registry_id is nullable initially (historical rows remain null).
  After enforcement boundary, new candidate scoring writes must populate it.

Required migration 2 (model_registry schema additions) — if not already present:
  ALTER TABLE model_registry
  ADD COLUMN IF NOT EXISTS registry_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS source_type_compatibility TEXT[],
  ADD COLUMN IF NOT EXISTS owner TEXT,
  ADD COLUMN IF NOT EXISTS training_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS training_window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_metrics JSONB,
  ADD COLUMN IF NOT EXISTS calibration_metadata JSONB,
  ADD COLUMN IF NOT EXISTS promotion_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS promotion_approved_at TIMESTAMPTZ;

Required code change (write path):
  At the point where model_score is written to pick_candidates, also write:
  - model_registry_id: look up model_registry.id WHERE sport = <candidate sport>
    AND market_family = <candidate market_family>
    AND registry_entity_type = 'champion_model'
    AND status = 'champion'
  - scoring_run_id: the system_runs.id for the current scoring run
  - ownership_timestamp: NOW() (transaction time)

## Output files — all required

  docs/06_status/proof/ownership-persistence/ownership-summary.json
  docs/06_status/proof/ownership-persistence/ownership-gaps.csv
  docs/06_status/proof/ownership-persistence/ownership-code-paths.json
  docs/06_status/proof/ownership-persistence/ownership-migration-plan.json
  docs/06_status/proof/ownership-persistence/README.md

## ownership-summary.json schema (version 1)

{
  "schema_version": 1,
  "generated_at": "<ISO>",
  "evaluation_window_days": 30,
  "system_verdict": "PASS | WARN | FAIL",
  "schema_state": {
    "pick_candidates_has_model_registry_id": false,
    "pick_candidates_has_scoring_run_id": false,
    "pick_candidates_has_ownership_timestamp": false,
    "model_registry_has_registry_entity_type": false,
    "model_registry_has_source_type_compatibility": false,
    "model_registry_missing_columns": [],
    "picks_source_check_constraint_exists": true,
    "picks_source_constraint_definition": ""
  },
  "gap_counts": {
    "picks_without_candidate_link": 0,
    "picks_with_candidate_link_no_registry_fk": 0,
    "registry_entries_missing_entity_type": 0,
    "total_model_attributed": 0,
    "total_ownership_unknown": 0
  },
  "code_path_findings": {
    "model_score_write_locations": [],
    "scan_run_id_write_locations": [],
    "system_pick_scanner_source_locations": [],
    "model_registry_id_write_locations": [],
    "ownership_write_gap_confirmed": true
  },
  "migration_plan": {
    "migration_1_pick_candidates_fk": "pending_operator_approval",
    "migration_2_model_registry_additions": "pending_operator_approval",
    "code_change_write_path": "pending_operator_approval",
    "estimated_tables_affected": ["pick_candidates", "model_registry"],
    "estimated_rows_affected_by_migration": 0
  }
}

## ownership-gaps.csv columns

pick_id, source_value, entity_type, candidate_linked, model_registry_id_present,
gap_type, gap_description, created_at

One row per pick with a gap. gap_type values:
  no_candidate_link, no_registry_fk_column, registry_fk_null,
  registry_entry_missing_entity_type

## ownership-code-paths.json

{
  "model_score_write_locations": [
    {
      "file": "<relative path>",
      "line_range": "<start-end>",
      "function": "<function name>",
      "writes_model_registry_id": false,
      "notes": ""
    }
  ],
  "scan_run_id_write_locations": [...],
  "system_pick_scanner_source_locations": [...],
  "insertion_point_recommendation": "<file>:<line> — write model_registry_id here"
}

## ownership-migration-plan.json

{
  "migration_1": {
    "table": "pick_candidates",
    "sql": "ALTER TABLE pick_candidates ADD COLUMN model_registry_id UUID REFERENCES model_registry(id), ADD COLUMN scoring_run_id UUID REFERENCES system_runs(id), ADD COLUMN ownership_timestamp TIMESTAMPTZ;",
    "nullable": true,
    "backfill_required": false,
    "estimated_rows": 0,
    "requires_operator_approval": true
  },
  "migration_2": {
    "table": "model_registry",
    "sql": "ALTER TABLE model_registry ADD COLUMN IF NOT EXISTS registry_entity_type TEXT, ...",
    "nullable": true,
    "backfill_required": false,
    "requires_operator_approval": true
  },
  "code_change": {
    "file": "<file from code_path_findings>",
    "insertion_point": "<line>",
    "description": "At model_score write time, additionally write model_registry_id, scoring_run_id, ownership_timestamp in the same transaction",
    "requires_operator_approval": true
  }
}

## Implementation rules

1. Read-only queries only. No writes to any table.
2. Use the existing Supabase client from packages/db.
3. If model_registry_id column does not exist, record this and continue — do not fail.
4. If system_runs table does not exist as a FK target, record this in migration_plan and propose UUID-only scoring_run_id.
5. All file search findings must include relative file path and line range.
6. Do not guess file paths — use actual file search results.
7. README must include: "0% model attribution at baseline. All scanner picks are heuristic until migration + code change are approved and deployed."

## Do NOT

- Add any migration or ALTER TABLE
- Write to any production table
- Assign any historical pick to a registry entry
- Claim model edge
- Infer ownership from score values

## Verification steps (all required)

1. pnpm type-check — must pass
2. Write tests at scripts/ownership-persistence/run-ownership-report.test.ts:
   - Verifies all five output files are created
   - Verifies ownership-summary.json has schema_version: 1
   - Verifies schema_state section is populated with real values
   - Verifies code_path_findings.model_score_write_locations is an array (may be empty if not found)
   - Verifies ownership-migration-plan.json has migration_1 and migration_2 sections
   - Verifies no string "model has edge" in any output file
3. pnpm test:db — must pass
4. pnpm verify — must pass

## Stop conditions

Stop and escalate if:
- model_registry table does not exist
- pick_candidates table does not exist
- File search returns errors (not just empty results — empty is acceptable)
- Any output directory cannot be written

## Expected findings (verify from real data)

Based on UTV2-850 findings:
  - pick_candidates.model_registry_id: does not exist
  - model_registry has 6 champion entries
  - model_registry missing: registry_entity_type, source_type_compatibility, owner,
    training_window_*, validation_metrics, calibration_metadata,
    promotion_approved_by, promotion_approved_at
  - Code path: model_score is written somewhere in the scanner; location TBD
  - picks.source check constraint: exists (confirmed by UTV2-849 pass)

Do not pre-populate. Verify from real queries and file search.
```
