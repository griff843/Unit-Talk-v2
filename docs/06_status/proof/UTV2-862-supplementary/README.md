# UTV2-862 Supplementary Verification Artifacts

**Lane state:** UTV2-862 was closed via PR #607 (merge `592bd869`) on 2026-05-09 because the *audit* was complete. The provider-history lifecycle gate `merge_provider_offer_staging_cycle` is **not cleared** — see `final-lifecycle-results.json`.

These six artefacts were generated post-merge during continued live verification and were left untracked. They are landed here as a single supplementary bundle so the lane's evidence trail is complete on `main`.

## Contents

| File | What it is |
|---|---|
| `cron-verification-plan.md` | Verification plan for the nightly retention prune cron (03:00 UTC, `nightly-retention-prune`). |
| `cron-verification-checklist.md` | Operator pre-window / post-window checklist for the same cron. |
| `manual-lifecycle-verification.md` | Operator-run manual lifecycle walkthrough on 2026-05-09 (controlled before the cron window). |
| `manual-lifecycle-results.json` | Machine-readable results from the manual walkthrough. |
| `final-lifecycle-verification.md` | Final live re-run of the full lifecycle (summarize → drop → prune). |
| `final-lifecycle-results.json` | Machine-readable results from the final live re-run. |

## Findings (summary)

- `summarize_provider_offer_history_partition('2026-04-29')` — **PASS**.
- `drop_old_provider_offer_history_partitions(7)` — **FAIL** (`SQLSTATE 42501: must be owner of table provider_offer_history_p20260502`). Filed as a separate follow-up issue in the UTV2-864 milestone audit.
- `prune_provider_offers_bounded(7,5000,20)` — **FAIL** (`SQLSTATE 57014: canceling statement due to statement timeout`). Filed as a separate follow-up issue in the UTV2-864 milestone audit.

The lifecycle gate `merge_provider_offer_staging_cycle` correctly remains **closed** — no row loss, but two phases fail live.

## Cross-references

- Closed lane manifest: `docs/06_status/lanes/UTV2-862.json` (`status: "closed"`, merge `592bd869`).
- Original lane proof (frozen): `docs/06_status/proof/UTV2-862-provider-history-audit.md`.
- Follow-up tracking: `docs/06_status/proof/UTV2-864-milestone-truth-audit.md` §6 ("DB / Provider Lifecycle Truth") and §8 ("Linear Issue Audit").
