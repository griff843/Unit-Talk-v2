# UTV2-1369 Diff Summary

## Summary

Read-only Supabase usage/cost audit (docs-only lane, no source edits). The Codex execution pass produced only proof scaffolding without the actual audit deliverable; the audit itself (`docs/06_status/audits/supabase-usage-cost-truth-audit.md`) was completed directly against live Supabase (read-only `SELECT` queries + Performance Advisor) before this lane closed.

## Headline finding

Total database size 18 GB. `provider_offers_legacy_quarantine` (explicitly legacy/frozen) alone is 6.5 GB — 36% of the database. Provider-offer data (current + legacy + history) combined is ~78% of total storage. Date-partitioned `provider_offer_history` tables give a measured growth rate of ~903 MB/day when ingestion is active — currently suppressed by the ongoing ingestor outage (UTV2-1477/1478), not resolved.

## Files Changed

- `docs/06_status/audits/supabase-usage-cost-truth-audit.md` (new) — the audit deliverable: top cost drivers, measured growth rate, Performance Advisor findings (153 unused indexes, 137 unindexed FKs), and immediate cost stop conditions.
- `docs/06_status/proof/UTV2-1369/diff-summary.md` — this file.
- `docs/06_status/proof/UTV2-1369/verification.md` — verification log.
- `.ops/sync/UTV2-1369.yml`, `docs/06_status/lanes/UTV2-1369.json` — lane bookkeeping (orchestration-generated).

## Scope Notes

- No runtime code, database schema, package contracts, domain logic, or generated files were changed — read-only audit only, per issue acceptance criteria.
- No query rewrite or optimization implementation performed in this lane; follow-up lanes are listed in the audit doc.
