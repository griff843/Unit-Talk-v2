# merge-risk-v1

## Purpose and usage

`merge-risk.ts` is a read-only operational analysis script for lane merge safety. It reads active lane manifests, compares them against GitHub PR and remote branch state, and emits a JSON report to stdout.

Run it with:

```bash
npx tsx scripts/ops/merge-risk.ts
```

Optional flag:

```bash
npx tsx scripts/ops/merge-risk.ts --json
```

The current implementation always emits JSON. It exits `0` when no `hard_fail` conditions are present and exits `1` when one or more `hard_fail` conditions are detected.

## MergeRiskReport

```ts
interface MergeRiskReport {
  generated_at: string;
  total_active_lanes: number;
  conditions: MergeRiskCondition[];
  summary: {
    hard_fail: number;
    block: number;
    warning: number;
  };
}
```

Field descriptions:

- `generated_at`: ISO-8601 timestamp for when the report was built.
- `total_active_lanes`: Count of lane manifests considered active by the script.
- `conditions`: All detected merge-risk conditions.
- `summary.hard_fail`: Count of conditions with severity `hard_fail`.
- `summary.block`: Count of conditions with severity `block`.
- `summary.warning`: Count of conditions with severity `warning`.

## MergeRiskCondition

```ts
interface MergeRiskCondition {
  code: string;
  severity: 'hard_fail' | 'block' | 'warning';
  lanes: string[];
  detail: string;
}
```

Field descriptions:

- `code`: Stable machine-readable risk code.
- `severity`: Operational severity of the risk.
- `lanes`: Related lane issue IDs when known. Empty when the risk is not tied to a manifest.
- `detail`: Human-readable explanation of the detected condition.

## Risk codes

### `FILE_OVERLAP`

- Severity: `block`
- Condition: Two active lanes share one or more `file_scope_lock` paths.
- Remediation: Re-scope one lane, close one lane, or merge the work into a single coordinated lane before proceeding.

### `ACTIVE_BRANCH_NO_PR`

- Severity: `warning`
- Condition: An active lane branch exists on `origin` but has no open pull request.
- Remediation: Open the PR if the lane is reviewable, or remove the remote branch if it should not be active.

### `PR_NO_ACTIVE_LANE`

- Severity: `warning`
- Condition: An open pull request exists but no active lane manifest matches its branch.
- Remediation: Recreate or reopen the lane manifest, or close the PR if it is stale or invalid.

### `MERGED_PR_ACTIVE_LANE`

- Severity: `hard_fail`
- Condition: A merged PR branch still has a lane manifest marked active.
- Remediation: Reconcile lane state immediately and close or advance the manifest so merge truth matches operational truth.

### `BLOCKED_DEP_NOT_DONE`

- Severity: `block`
- Condition: A lane's `blocked_by` list references another issue that is still active.
- Remediation: Finish or close the dependency first, or remove the blocker from the manifest if it is no longer applicable.

### `TIER_C_CONFLICT`

- Severity: `hard_fail`
- Condition: Two active lanes both touch Tier C paths under `packages/`.
- Remediation: Stop parallel work on those paths and escalate for coordinated sequencing or merge approval.

### `STALE_LANE_HEARTBEAT`

- Severity: `warning`
- Condition: A lane heartbeat is more than 72 hours old.
- Remediation: Refresh the heartbeat if the lane is active, or block/close the lane if it has gone stale.

### `DISPATCH_LIMIT_SATURATION`

- Severity: `block`
- Condition: Active executor usage exceeds dispatch limits: codex lanes `>= 2` or claude lanes `>= 1`.
- Remediation: Do not dispatch additional work until an active lane is closed, merged, or otherwise cleared.

## Example JSON output

```json
{
  "generated_at": "2026-05-15T13:20:00.000Z",
  "total_active_lanes": 3,
  "conditions": [
    {
      "code": "FILE_OVERLAP",
      "severity": "block",
      "lanes": ["UTV2-973", "UTV2-981"],
      "detail": "Shared file_scope_lock paths: scripts/ops/shared.ts"
    },
    {
      "code": "STALE_LANE_HEARTBEAT",
      "severity": "warning",
      "lanes": ["UTV2-982"],
      "detail": "heartbeat_at is 89h old for branch \"codex/utv2-982-stale\""
    }
  ],
  "summary": {
    "hard_fail": 0,
    "block": 1,
    "warning": 1
  }
}
```
