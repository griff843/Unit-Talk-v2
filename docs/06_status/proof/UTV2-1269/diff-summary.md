# UTV2-1269 — Diff Summary

**Lane:** UTV2-1269 — Smart Form canonical provider market identity requirements
**Tier:** T2 · **Lane type:** governance (requirements/docs) · **Executor:** Claude
**PR:** #1051 · **Merge SHA:** `0d9b8a542b1bcc94fa3e324cc3c237fb183c1f7c`

## Files changed
- `docs/05_operations/SMART_FORM_PROVIDER_IDENTITY_REQUIREMENTS.md` (new) — the canonical requirements contract for provider-truth-safe Smart Form intake.

## What this delivers
A requirements-only specification: required intake fields (provider identity, entry economics, line classification), provider-truth validation axes at entry, fail-closed validation behavior, and persistence requirements (entry + provider state retained, alt-line segregation). No UI, schema, scoring, or CLV implementation — those require a separate PM-approved lane.

## Out of scope (guardrails honored)
No implementation. No DB schema/migration. No scoring/CLV changes. No Discord. UTV2-1042 untouched. No CLV/ROI/edge claims.
