# Week 12 — Proof Template

Authority: `docs/05_operations/week_12_settlement_hardening_contract.md`

---

## Metadata

| Field | Value |
|---|---|
| Week | 12 |
| Recorded by | ___ |
| Last updated | ___ |

---

## Pre-Implementation Baseline

Confirm before writing any Week 12 code.

| Check | Required | Observed | Pass? |
|---|---|---|---|
| `pnpm test` | 72/72 | ___ | ___ |
| `pnpm test:db` | 1/1 | ___ | ___ |
| Existing settlement tests | 4 passing | ___ | ___ |
| `POST /api/picks/:id/settle` happy path | live and working | ___ | ___ |

Baseline verdict:
```
[ ] PASS — proceed with Week 12 implementation
[ ] FAIL — halt; do not start Week 12 until pre-Week-12 baseline is restored
```

---

## Part 1 — Slice 1: Manual Review Resolution Path

### 1a. Two-phase resolution tests

| Scenario | Test exists? | Test passes? |
|---|---|---|
| `manual_review` record followed by subsequent settlement → two `settlement_records` rows | ___ | ___ |
| Pick transitions to `settled` after two-phase resolution | ___ | ___ |
| `manual_review` row is not mutated after subsequent settlement | ___ | ___ |

### 1b. Operator snapshot — two-phase picks

| Check | Test exists? | Test passes? |
|---|---|---|
| Operator snapshot returns both records for two-phase picks (not just latest) | ___ | ___ |

### 1c. Operator-web HTML — `[MANUAL REVIEW]` label

| Check | Evidence |
|---|---|
| `[MANUAL REVIEW]` label rendered for `manual_review` status records | Code read |
| Label is visually distinct from settled outcome records | Code read |

### Slice 1 verdict

```
[ ] PASS — all 1a–1c checks confirmed
[ ] FAIL — see week_12_failure_rollback_template.md
```

---

## Part 2 — Slice 2: Correction Chain Hardening

### 2a. Multi-hop correction chain tests

| Scenario | Test exists? | Test passes? |
|---|---|---|
| First correction produces row B with `corrects_id = A.id` | ___ | ___ |
| Second correction produces row C with `corrects_id = B.id` | ___ | ___ |
| All three rows (A, B, C) exist after multi-hop chain | ___ | ___ |
| None of A, B, C are mutated | ___ | ___ |

### 2b. Operator snapshot — `corrects_id` surfaced

| Check | Test exists? | Test passes? |
|---|---|---|
| Operator snapshot includes `corrects_id` for correction records | ___ | ___ |
| Correction record `corrects_id` points to the correct preceding record ID | ___ | ___ |

### 2c. Operator-web HTML — `[CORRECTION]` label

| Check | Evidence |
|---|---|
| `[CORRECTION]` label rendered for correction records | Code read |
| Correction label includes reference to which record it corrects | Code read |

### Slice 2 verdict

```
[ ] PASS — all 2a–2c checks confirmed
[ ] FAIL — see week_12_failure_rollback_template.md
```

---

## Part 3 — Slice 3: Operator Settlement History

### 3a. Settlement record fields in operator snapshot

| Check | Test exists? | Test passes? |
|---|---|---|
| Operator snapshot includes `status` field on each settlement record | ___ | ___ |
| Operator snapshot includes `corrects_id` field on each settlement record | ___ | ___ |

### 3b. All records returned per pick

| Check | Evidence |
|---|---|
| Pick with `manual_review` + subsequent `settled` returns both records | Test or code read |

### 3c. HTML labels

| Check | Evidence |
|---|---|
| `[MANUAL REVIEW]` label renders distinctly | Code read |
| `[CORRECTION]` label renders distinctly | Code read |

### Slice 3 verdict

```
[ ] PASS — all 3a–3c checks confirmed
[ ] FAIL — see week_12_failure_rollback_template.md
```

---

## Part 4 — Slice 4: Expanded Test Coverage

All 10 scenarios defined in §Slice 4 of the contract must have at least one test each.

| # | Scenario | Test file | Test name / description | Pass? |
|---|---|---|---|---|
| 1 | Reject `POST /api/picks/:id/settle` when pick is in `validated` state | ___ | ___ | ___ |
| 2 | Reject `POST /api/picks/:id/settle` when pick is in `queued` state | ___ | ___ | ___ |
| 3 | Reject `POST /api/picks/:id/settle` when pick does not exist | ___ | ___ | ___ |
| 4 | Reject `manual_review` request without `reviewReason` | ___ | ___ | ___ |
| 5 | `manual_review` → subsequent settlement → two rows, pick `settled`, `manual_review` row unchanged | ___ | ___ | ___ |
| 6 | Original settlement record fields unchanged after correction | ___ | ___ | ___ |
| 7 | Multi-hop correction chain: three records, `corrects_id` chain intact, none mutated | ___ | ___ | ___ |
| 8 | Operator snapshot settlement records include `status` and `corrects_id` fields | ___ | ___ | ___ |
| 9 | Operator snapshot returns both records for two-phase pick | ___ | ___ | ___ |
| 10 | Correction record in operator snapshot has `corrects_id` pointing to original record ID | ___ | ___ | ___ |

### Slice 4 verdict

```
[ ] PASS — all 10 scenarios covered by tests, all pass
[ ] FAIL — see week_12_failure_rollback_template.md
```

---

## Part 5 — Regression and Gate Check

| Check | Required | Observed | Pass? |
|---|---|---|---|
| Pre-Week-12 settlement tests (4 existing) | all pass | ___ | ___ |
| `pnpm test` total | ≥ 82 (72 + ≥ 10 new) | ___ | ___ |
| `pnpm test:db` | 1/1 | ___ | ___ |
| `pnpm type-check` | clean | ___ | ___ |
| `pnpm build` | clean | ___ | ___ |
| No new settlement schema changes | confirmed | ___ | ___ |
| Automated settlement decision recorded | yes — §Automated Settlement Input in contract | ___ | ___ |

---

## Overall Proof Verdict

```
[ ] PASS — all slices confirmed, ≥ 82 tests pass, no regressions, pnpm verify clean
[ ] FAIL — see week_12_failure_rollback_template.md
[ ] INCOMPLETE — fields missing or tests not yet run
```

Recorded by: ___
Date: ___
