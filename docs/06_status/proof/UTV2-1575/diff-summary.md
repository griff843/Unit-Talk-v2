# Diff Summary: UTV2-1575

## Files changed

| File | Change |
| --- | --- |
| `docs/06_status/FIVE_PR_MIGRATION_PR1_EVIDENCE.md` | New. Evidence record for PR1: environment-protection verification, secret inventory, GitHub App manifest pointer, and the remaining-work checklist. |
| `docs/05_operations/policies/GITHUB_APP_MANIFESTS_PR1.md` | New. Exact permission/scope specs for the `unit-talk-executor` and `unit-talk-reviewer` GitHub Apps, ready for Griff to register. |
| `docs/06_status/lanes/UTV2-1575.json`, `.ops/sync/UTV2-1575.yml`, `docs/06_status/proof/UTV2-1575/*` | This lane's own manifest, sync record, and proof bundle. |

## Not changed

- No workflow file.
- No branch protection or required-check context.
- No product/runtime code.

## Live platform change (documented, not in this diff)

`production` and `canary` environment protection rules (required reviewer: `griff843`) were applied via a
direct API call on 2026-07-22 -- see the evidence doc's process note for the sequencing gap this represents.

## Why

PR1 of the five-PR migration authorized by UTV2-1574. Full rationale: `verification.md`.
