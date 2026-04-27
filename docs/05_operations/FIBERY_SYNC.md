# Fibery GitHub Sync

GitHub PR and merge events append dated notes to Fibery entities listed in `.ops/sync.yml`.

## Lane-Start Readiness

Run this before T1/T2 implementation begins, after the lane manifest exists and before code changes:

```bash
pnpm ops:fibery-check UTV2-123
```

The check verifies the lane manifest, `.ops/sync.yml`, `.ops/fibery-policy.yml`, and the existence of every listed Fibery entity. It fails clearly with `fibery_readiness_unverified` when `FIBERY_API_URL` or `FIBERY_API_TOKEN` is missing; do not treat that as a pass. In that case, PM or the lane owner must manually confirm the Fibery entities before implementation starts.

Expected T1/T2 mapping:

| Surface | Required value |
|---|---|
| Linear issue | The `UTV2-###` issue being worked. |
| Lane manifest | `docs/06_status/lanes/UTV2-###.json` with matching `issue_id` and tier. |
| Proof artifact path | `expected_proof_paths[]` in the lane manifest. T1/T2 lanes must declare at least one expected proof path. |
| Fibery issue entity | `.ops/sync.yml` `entities.issues[]` must include the same `UTV2-###`. |
| Fibery proof entity | `.ops/sync.yml` `entities.proofs[]` must include the Fibery proof artifact ID that corresponds to the expected proof path. |

Manual checklist when credentials are unavailable:

- Confirm the lane manifest exists and `issue_id` matches the Linear issue.
- Confirm T1/T2 manifests declare `expected_proof_paths`.
- Confirm Fibery has the matching `Unit Talk/Issue` entity.
- Confirm Fibery has the matching `Unit Talk/Proof Artifacts` entity for each required proof artifact.
- Confirm `.ops/sync.yml` lists those issue and proof entities with `approval.skip_sync_required: false`.
- Record in the PR body or a PR comment who performed the manual check and which Fibery entities were confirmed.

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

## `.ops/sync.yml` Rules

- `approval.skip_sync_required: false` is required for normal T1/T2 implementation lanes. Do not set it to `true` to work around missing Fibery entities.
- `approval.allow_multiple_issues: true` is allowed only for an intentionally multi-issue PR and still requires the `multi-issue-pr-approved` label.
- `entities.issues[]` lists the Linear issue IDs whose Fibery issue entities must receive PR and merge sync notes. The active lane issue must be present.
- `entities.proofs[]` lists Fibery proof artifact IDs for proof-sensitive work and all T1/T2 lanes with expected proof paths.
- `entities.findings[]` and `entities.controls[]` list existing governance entities that need append-only sync notes.
- Clearing tracked entities is not acceptable for T1/T2 lanes. It hides sync drift, prevents PR/merge audit notes, and turns a missing Fibery seed into an untracked governance gap.

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

## Bypass Policy

Use `fibery-sync-bypass-approved` only when the blocker is a sync-seeding failure, not a product implementation, verification, or proof failure. A bypass requires:

- PM comment approving the bypass.
- The `fibery-sync-bypass-approved` label.
- PR body or PR comment stating exactly which Fibery entity was missing and why merge remains safe.
- Follow-up seeding of the missing Fibery entity after merge.

Bypass approval does not waive proof obligations, tests, verification, or the lane manifest contract.
