# Documentation Truth Gate V1 Scope Inventory

## Purpose

This inventory records which currently governed docs are truthfully in scope for V1 domain-analysis consumer-truth enforcement.

V1 checker reality today:
- evidence scanning is domain-analysis-specific
- enforcement is strongest for structured consumer docs with explicit file paths and status markers
- policy/example docs may mention consumer truth without being live consumer declarations

This file is factual only. It does not change gate policy or workflow scope.

## Scope Table

| Path | References domain-analysis consumer truth | Should be in V1 enforced scope | Reason | Risk if falsely treated as governed now | Suggested future surface tag |
|---|---|---|---|---|---|
| `docs/02_architecture/domain_model.md` | No | No | Domain model overview only; no domain-analysis consumer claims were found. | Low: broad architecture prose could be over-read as governed consumer truth. | `domain-model` |
| `docs/02_architecture/rebuild_scope.md` | No | No | Rebuild scope doc; no domain-analysis consumer truth claims were found. | Low: could create noise without adding enforcement value. | `rebuild-scope` |
| `docs/02_architecture/week_19_downstream_consumer_matrix.md` | Yes | Yes | Directly documents `metadata.domainAnalysis` producer/consumer boundaries with file-level claims and binary statuses. | High: if excluded, false active or false non-consuming claims could slip through. | `domain-analysis-consumers` |
| `docs/02_architecture/contracts/board_promotion_contract.md` | No | No | Promotion contract; does not currently declare domain-analysis consumer truth. | Medium: a future promotion-surface gate may be needed, but V1 domain-analysis evidence does not fit this doc. | `promotion-consumers` |
| `docs/02_architecture/contracts/distribution_contract.md` | No | No | Distribution contract; no domain-analysis consumer claims were found. | Medium: downstream consumer language exists, but for a different surface. | `distribution-consumers` |
| `docs/02_architecture/contracts/environment_contract.md` | No | No | Environment/config contract; no domain-analysis consumer truth claims were found. | Low: false governance noise only. | `environment-contract` |
| `docs/02_architecture/contracts/pick_lifecycle_contract.md` | No | No | Lifecycle contract; no domain-analysis consumer truth claims were found. | Medium: lifecycle readers/writers are a different enforcement surface. | `pick-lifecycle-consumers` |
| `docs/02_architecture/contracts/run_audit_contract.md` | No | No | Mentions "consumers of audit state," but not domain-analysis consumer truth. | Medium: consumer language could be misclassified even though the governed surface is audit state, not domain analysis. | `run-audit-consumers` |
| `docs/02_architecture/contracts/settlement_contract.md` | No | No | Contains settlement-dependent future consumers, not domain-analysis consumers. | High: V1 domain-analysis enforcement could false-fail on settlement consumer planning language. | `settlement-consumers` |
| `docs/02_architecture/contracts/submission_contract.md` | No | No | Submission contract defines intake and validation boundaries, not domain-analysis consumer truth. | Low: little enforcement value for V1. | `submission-consumers` |
| `docs/02_architecture/contracts/writer_authority_contract.md` | No | No | Writer authority contract; no domain-analysis consumer truth claims were found. | Medium: writer/reader authority is a separate enforcement dimension. | `writer-authority` |
| `docs/03_contracts/consumer_classification_governance.md` | Yes | No | Governance rule references domain-analysis consumer examples, but it is policy/examples only, not a live consumer declaration doc. | Medium: if treated as live governed consumer truth, examples can be mistaken for real runtime claims. | `policy-meta` |
| `docs/03_contracts/domain_analysis_consumer_contract.md` | Yes | Yes | Authoritative contract for `pick.metadata.domainAnalysis` producer and consumer truth. | High: if excluded, the primary controlled-surface contract loses enforcement. | `domain-analysis-consumers` |

## V1 Boundary Summary

Docs that are truthfully in V1 enforced scope today:
- `docs/02_architecture/week_19_downstream_consumer_matrix.md`
- `docs/03_contracts/domain_analysis_consumer_contract.md`

Docs that reference consumer language but should remain out of V1 enforced scope:
- `docs/03_contracts/consumer_classification_governance.md`
- `docs/02_architecture/contracts/run_audit_contract.md`
- `docs/02_architecture/contracts/settlement_contract.md`

Reason:
- the V1 checker uses domain-analysis-specific evidence tokens
- the V1 checker is designed for live consumer declarations, not generic governance prose or other data surfaces

## Notes

- This inventory does not claim that out-of-scope docs are unimportant.
- It only records whether V1 domain-analysis enforcement is a truthful fit for the doc as it exists today.
- If V1.1 becomes surface-aware, several currently out-of-scope docs could move into enforcement with per-surface evidence rules.
