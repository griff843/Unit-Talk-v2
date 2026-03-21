# Week 12 — Failure / Rollback Record Template

Authority: `docs/05_operations/week_12_settlement_hardening_contract.md`

Use this template if any rollback trigger fires during Week 12. Fill all fields with exact observed values.

---

## Metadata

| Field | Value |
|---|---|
| Week | 12 |
| Template status | ___ (in-use / archived — not triggered) |
| Trigger timestamp | ___ |
| Recorded by | ___ |

---

## Part 1 — Trigger Identification

Which condition fired? (check all that apply)

- [ ] Any pre-Week-12 settlement test regressed (4 existing tests)
- [ ] `pnpm test:db` failed
- [ ] `POST /api/picks/:id/settle` happy path broke
- [ ] Operator settlement snapshot stopped returning settlement rows
- [ ] `pnpm type-check` or `pnpm build` failed after changes
- [ ] Other: ___

---

## Part 2 — Regression Details

### 2a. Test regression

| Test / check | Before Week 12 | After Week 12 |
|---|---|---|
| `pnpm test` count | 72 | ___ |
| Regressed test name(s) | — | ___ |
| `pnpm test:db` | 1/1 | ___ |
| Specific settlement test failures | — | ___ |

### 2b. Settlement behavior regression

| Check | Expected | Observed |
|---|---|---|
| `POST /api/picks/:id/settle` happy path | `posted → settled` | ___ |
| `settlement_records` row created | yes | ___ |
| Audit event `settlement.recorded` written | yes | ___ |
| Operator snapshot returns settlement rows | yes | ___ |

### 2c. DB state at regression

| Table | Row ID | Observed state | Expected state |
|---|---|---|---|
| `settlement_records` | ___ | ___ | ___ |
| `picks` | ___ | ___ | ___ |
| `audit_log` | ___ | ___ | ___ |

---

## Part 3 — Rollback Actions

| Action | Done? | Timestamp |
|---|---|---|
| Reverted Week 12 changes | ___ | ___ |
| `pnpm test` back to ≥ 72 | ___ | ___ |
| `pnpm test:db` passing | ___ | ___ |
| `POST /api/picks/:id/settle` happy path confirmed working | ___ | ___ |
| Operator snapshot confirmed returning settlement rows | ___ | ___ |
| Recorded in `docs/06_status/week_12_failure_rollback_template.md` | ___ | ___ |
| Updated `docs/06_status/status_source_of_truth.md` | ___ | ___ |

---

## Part 4 — Post-Rollback State

| Check | Observed | Expected |
|---|---|---|
| `pnpm test` | ___ | ≥ 72 |
| `pnpm test:db` | ___ | 1/1 |
| Settlement happy path | ___ | working |
| Operator snapshot settlement rows | ___ | returned |
| `pnpm type-check` | ___ | clean |

---

## Part 5 — Recovery Assessment

| Question | Answer |
|---|---|
| Root cause identified? | ___ |
| Regression confined to Week 12 changes? | ___ |
| Pre-Week-12 settlement path unaffected after rollback? | ___ |
| Recovery possible without new contract? | ___ |
| Estimated restart date if recovery possible | ___ |
| New contract addendum required? | ___ |

### Rollback verdict

```
[ ] REVERTED — all regressions fixed, Week 12 may restart after root cause is resolved
[ ] ESCALATED — regression in pre-Week-12 settlement path; requires architectural review before restart
```

Root cause:
```
___
```

Next steps:
```
1. ___
2. ___
3. ___
```

Recorded by: ___
Date: ___
