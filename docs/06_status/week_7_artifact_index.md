# Week 7 Artifact Index

This file is the canonical index of all artifacts produced during Week 7.

Week 7 scope: Controlled Real-Channel Best Bets Activation.
Week 7 status: **Complete** — formally closed 2026-03-20.

---

## Proof Bundle

| Field | Value |
|---|---|
| Submission ID | `0523898a-8491-47c6-b991-a7ac814f9177` |
| Pick ID | `a955039c-616a-4821-bd2a-098a799feb28` |
| Promotion status | `qualified` |
| Promotion target | `best-bets` |
| Promotion score | `92.20` |
| Promotion reason | `hard eligibility checks passed \| promotion score 92.20 meets threshold 70.00` |
| Promotion history ID | `14da895c-f06c-4baf-b0d5-d9b34030188a` |
| Outbox ID | `a938db43-c932-438c-9e32-32914c0b3cf8` |
| Outbox status | `sent` |
| Receipt ID | `bab12015-31f8-4835-9995-fe154557318e` |
| Discord message ID | `1484607152575352912` |
| Target channel ID | `1288613037539852329` |
| Run IDs | `aaeb10db-672c-4cba-9f2c-ba4065de0612` (enqueue), `cce8580e-cf96-460e-9dd2-079aff04eeb0` (process) |
| Audit action IDs | `d89a3b52-b806-402e-b18e-ef55ad27052b` (promotion.qualified) |
| Operator snapshot timestamp | `2026-03-20T17:38:47.401Z` |
| Worker health | `healthy` |
| Canary health | `graduationReady = true`, sent 3, failures 0, dead_letter 0 |

---

## Final Verification (Monitoring Window Complete)

Verified via Supabase PostgREST REST API (service_role_key, not worker log). Timestamp: 2026-03-20.

| Check | Result |
|---|---|
| All `discord:best-bets` outbox rows | 2 rows — both `sent`, zero `failed` or `dead_letter` |
| Failed/dead_letter across all targets | **0** |
| Canary recent outbox | 3 recent `sent` rows, 0 failures |
| Best-bets receipt confirmed | `discord:1288613037539852329`, dryRun: false, external_id matches Discord message ID |
| Pending/processing outbox rows | **0** — operator view clean |

**Verdict: PASS. No rollback trigger fired. Monitoring window complete. Week 7 closed.**

---

## Repo Files Created in Week 7

| File | Purpose |
|---|---|
| `docs/05_operations/week_7_best_bets_activation.md` | Activation contract and acceptance criteria |
| `docs/06_status/week_7_proof_bundle_template.md` | Proof bundle template (reference, blank) |
| `docs/06_status/week_7_rollback_record_template.md` | Rollback record template (reference, blank — not triggered) |
| `docs/06_status/week_7_artifact_index.md` | This file — canonical artifact index |
| `docs/05_operations/week_8_settlement_readiness_review.md` | Week 8 handoff package |

---

## Repo Files Updated in Week 7

| File | Change |
|---|---|
| `docs/06_status/status_source_of_truth.md` | Week 8, routing table, monitoring window closed |
| `docs/06_status/system_snapshot.md` | Proof bundle, final closeout record |
| `docs/06_status/current_phase.md` | Week 7 complete, Week 8 active |
| `docs/06_status/next_build_order.md` | Week 7 done, Week 8 settlement as Priority 1 |

---

## External Tracking

| System | Reference | Status |
|---|---|---|
| Linear | UNI-132 — UTV2-DIST-05: Week 7 Controlled Real-Channel Best Bets Activation | **Done** |
| Notion | Week 7 Checkpoint — Best Bets Controlled Activation (`3295f8be-e344-818b-95a1-ce845ea05971`) | **Done** |

---

## Rollback Record

No rollback record was created. No rollback trigger fired.

Reference template (unused): `docs/06_status/week_7_rollback_record_template.md`

---

## Naming Rule

Use `Week 7 Activation - <artifact>` headings inside `system_snapshot.md` for real evidence captured during the monitoring window.

Approved headings (used):
- `Week 7 Activation - Initial Proof Bundle`
- `Week 7 Activation - Monitoring Closeout`

Unused heading (no rollback):
- `Week 7 Activation - Rollback Record`

---

## Authority

- Activation contract: `docs/05_operations/week_7_best_bets_activation.md`
- Program state: `docs/06_status/status_source_of_truth.md`
- Full evidence record: `docs/06_status/system_snapshot.md`
