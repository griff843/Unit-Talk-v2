# execution-packet-v1

Schema version: `execution-packet-v1`

## Purpose

`execution-packet-v1` defines the standardized JSON packet generated from a lane manifest for a single execution lane. It gives the executor a deterministic summary of issue identity, file scope, verification obligations, proof expectations, and closeout instructions without mutating lane state.

## Fields

| Field | Type | Description |
|---|---|---|
| `issue_id` | `string` | Canonical Linear issue identifier such as `UTV2-969`. |
| `title` | `string` | Human-facing issue title. If the manifest does not carry a title field, generators may fall back to the issue ID. |
| `project` | `string` | Project name for the lane. Current generators use `Unit Talk V2`. |
| `tier` | `string` | Lane tier, typically `T1`, `T2`, or `T3`. |
| `lane_type` | `string` | Lane classification copied from the manifest. |
| `branch` | `string` | Branch name the executor must work on. |
| `execution_location` | `string` | Human-readable execution surface derived from `manifest.executor`. |
| `allowed_file_scope` | `string[]` | Canonical file scope copied from `manifest.file_scope_lock`. |
| `tier_c_warnings` | `string[]` | Warning strings for any Tier C paths in `allowed_file_scope`. |
| `blockers` | `string[]` | Blocking issue IDs or notes copied from `manifest.blocked_by`. |
| `required_verification` | `string[]` | Tier-derived verification checklist, supplemented with expected proof paths. |
| `expected_proof_paths` | `string[]` | Canonical proof artifact paths copied from `manifest.expected_proof_paths`. |
| `closeout_instructions` | `string[]` | Standard closeout reminders for verify, R-level, PR creation, tier label, and post-merge truth-check. |
| `source_of_truth.linear_url` | `string` | Canonical Linear URL in the form `https://linear.app/unit-talk-v2/issue/<issue_id>`. |
| `source_of_truth.branch` | `string` | Branch copied from the manifest for drift checks. |
| `source_of_truth.manifest_path` | `string` | Canonical manifest path in the form `docs/06_status/lanes/<issue_id>.json`. |
| `generated_at` | `string` | Packet generation timestamp in ISO 8601 format. |

## Tier C Paths

Tier C warnings are emitted for any allowed file scope entry that matches one of these path families:

- `packages/domain/`
- `packages/config/`
- `supabase/migrations/*.sql`

These warnings are advisory in the packet and indicate the lane requires PM approval before those files are edited.

## Execution Location Enum

| `manifest.executor` | `execution_location` |
|---|---|
| `claude` | `Claude Code (interactive)` |
| `codex-cli` | `Codex CLI (autonomous)` |
| `codex-cloud` | `Codex Cloud (autonomous)` |
| anything else or missing | `Unknown` |

## Tier Verification Rules

| Tier | Base `required_verification` |
|---|---|
| `T1` | `type-check`, `test`, `test:db`, `runtime-proof`, `evidence-bundle` |
| `T2` | `type-check`, `test`, `issue-specific verification` |
| `T3` | `type-check`, `test` |
| unknown | `type-check`, `test` |

After the base tier list is created, every entry in `expected_proof_paths` is appended if it is not already present.

## Example JSON

```json
{
  "issue_id": "UTV2-969",
  "title": "UTV2-969",
  "project": "Unit Talk V2",
  "tier": "T2",
  "lane_type": "runtime",
  "branch": "codex/utv2-969-generate-standardized-execution-packets",
  "execution_location": "Codex CLI (autonomous)",
  "allowed_file_scope": [
    "scripts/ops/execution-packet.ts",
    "scripts/ops/execution-packet.test.ts",
    "docs/05_operations/schemas/execution-packet-v1.md"
  ],
  "tier_c_warnings": [],
  "blockers": [],
  "required_verification": [
    "type-check",
    "test",
    "issue-specific verification",
    "docs/06_status/proof/UTV2-969/diff-summary.md"
  ],
  "expected_proof_paths": [
    "docs/06_status/proof/UTV2-969/diff-summary.md"
  ],
  "closeout_instructions": [
    "Run pnpm verify and ensure it passes",
    "Run npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD",
    "Open PR with title matching feat(ops): UTV2-969 description",
    "Apply tier label: gh pr edit <PR-number> --add-label tier:T2",
    "Run ops:truth-check after merge to close lane"
  ],
  "source_of_truth": {
    "linear_url": "https://linear.app/unit-talk-v2/issue/UTV2-969",
    "branch": "codex/utv2-969-generate-standardized-execution-packets",
    "manifest_path": "docs/06_status/lanes/UTV2-969.json"
  },
  "generated_at": "2026-05-15T12:00:00.000Z"
}
```

## Timestamp Format

`generated_at` uses ISO 8601 / `Date.prototype.toISOString()` format.
