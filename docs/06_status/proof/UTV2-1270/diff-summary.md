# UTV2-1270 — Diff Summary

**Lane:** UTV2-1270 — Command Center provider-truth validation panel (requirements + data contract)
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude

## Scope

Requirements/data-contract documentation only. No runtime, API, UI, schema, scoring, or certification
changes. One net-new doc plus lane bookkeeping.

## Files changed

| File | Change | Purpose |
|---|---|---|
| `docs/05_operations/CC_PROVIDER_TRUTH_VALIDATION_PANEL.md` | added | Requirements + per-row data contract for the panel. |
| `docs/06_status/lanes/UTV2-1270.json` | added | Lane manifest (lane-start). |
| `.ops/sync/UTV2-1270.yml` | added | Per-issue sync metadata (lane-start). |
| `docs/06_status/proof/UTV2-1270/diff-summary.md` | added | This file. |
| `docs/06_status/proof/UTV2-1270/verification.md` | added | Verification record. |

## What the document delivers

- Per-row data contract with exact field names, types, and sources grounded in the existing classifier
  (`apps/api/src/scripts/sgo-provider-truth-audit.ts`).
- Verdict and reason-code vocabulary reproduced verbatim (FAIL/WARN/PASS enums).
- Six operator display buckets (provider-verified PASS, DB-signal PASS advisory, WARN, FAIL,
  forward-flow, backfilled).
- `provider_truth_verified` semantics: `db_signal_only` is never provider-truth verified.
- Forward-flow vs backfill provenance contract.
- UTV2-1042 eligibility as an advisory display-only field (no certification, no state change).
- Enumerated upstream dependencies and net-new gaps (UTV2-1267 sampled coverage, UTV2-1268 native
  close capture, overround band, UTV2-1250 metric).

## Guardrail compliance

- No CLV/ROI/edge claims. No P3 certification. No UTV2-1042 Done. No public Discord changes.
- No write path, no threshold/freshness changes. Implementation explicitly deferred to a separate
  PM-approved lane.
