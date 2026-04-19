# Fibery GitHub Sync

GitHub PR and merge events append dated notes to Fibery entities listed in `.ops/sync.yml`.

## Required PR Metadata

Every PR must declare exactly one normal implementation issue unless a maintainer explicitly approves multiple issues:

```yaml
version: 1
approval:
  allow_multiple_issues: false
entities:
  issues:
    - UTV2-123
  findings:
    - FINDING-123
  controls:
    - CTRL-123
  proofs:
    - PROOF-123
```

Use `approval.allow_multiple_issues: true` only when the PR intentionally spans multiple implementation issues. The workflow fails when no issue ID is declared, or when multiple issue IDs are declared without that flag.

## What The Automation Does

- PR opened, reopened, ready for review, or synchronized: append a dated note to every referenced Fibery entity.
- PR event for normal implementation issues: set the issue state to `In Review`.
- Merge event for normal implementation issues: append a dated note and set the issue state to `Done`.
- Findings, controls, and proofs are append-only in this MVP.
- Controls are never marked `Proven` from merge alone.
- Findings are never auto-resolved.

## Required Secrets

Configure these GitHub Actions secrets:

- `FIBERY_API_URL`: workspace URL, for example `https://example.fibery.io`
- `FIBERY_API_TOKEN`: Fibery API token with permission to query and update the configured entity types

Set `FIBERY_SYNC_DRY_RUN=true` in a workflow environment to emit planned operations without calling Fibery.

## Policy

`.ops/fibery-policy.yml` maps IDs to Fibery entity types and fields. Keep state updates limited to `entities.issues.state_updates` unless a later governance change explicitly expands automation authority.
