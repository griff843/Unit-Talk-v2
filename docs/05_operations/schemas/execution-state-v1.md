# Execution State Report v1

## Status

- Version: `v1`
- Producer: `scripts/ops/execution-state.ts`
- Output mode: JSON only
- Mutability: read-only

## Purpose

The execution-state report is a read-only observability snapshot for current lane execution truth. It aggregates active lane manifests into one JSON object so operators can inspect:

- currently active lanes
- lanes that are blocked or dependency-constrained
- executor slot saturation
- merge-risk condition counts
- proof-readiness by lane
- source-of-truth links back to manifests, Linear, and GitHub

This report is observational only. It must not write manifests, mutate files, call Linear write APIs, or push to GitHub.

## Shape

```ts
interface ExecutionStateReport {
  generated_at: string;
  active_lanes: LaneSummary[];
  blocked_lanes: LaneSummary[];
  dispatch_slots: {
    claude: { used: number; max: number; available: number };
    codex: { used: number; max: number; available: number };
  };
  merge_risk_summary: {
    hard_fail: number;
    block: number;
    warning: number;
    top_conditions: string[];
  };
  proof_readiness: ProofReadiness[];
  source_of_truth: {
    manifests_path: string;
    linear_url: string;
    github_url: string;
  };
}

interface LaneSummary {
  issue_id: string;
  branch: string;
  executor: string;
  tier: string;
  status: string;
  heartbeat_at: string;
  pr_url: string | null;
  blockers: string[];
  source_url: string;
}

interface ProofReadiness {
  issue_id: string;
  tier: string;
  required_artifacts: string[];
  present_artifacts: string[];
  ready: boolean;
}
```

## Field Semantics

| Field | Type | Meaning |
|---|---|---|
| `generated_at` | ISO-8601 string | Report generation timestamp |
| `active_lanes` | `LaneSummary[]` | All manifests whose `status` is in the active lock set |
| `blocked_lanes` | `LaneSummary[]` | Active lanes whose `status` is `blocked` or whose `blocked_by[]` is non-empty |
| `dispatch_slots` | object | Current executor usage against lane-capacity limits |
| `merge_risk_summary` | object | Severity counts plus the top three most severe condition codes |
| `proof_readiness` | `ProofReadiness[]` | Artifact presence summary for each active lane |
| `source_of_truth` | object | Canonical paths and URLs referenced by the report |

## Active Lane Rules

`active_lanes` is derived from the manifest active-lock statuses in `scripts/ops/shared.ts`:

- `started`
- `in_progress`
- `in_review`
- `blocked`
- `reopened`

Stale lanes are still visible. Staleness is reported through merge-risk conditions; it does not remove the lane from `active_lanes`.

## Dispatch Slot Rules

The report exposes executor capacity using the current policy values:

- `claude`: max `1`
- `codex`: max `2`

`available` is `max(0, max - used)`.

## Merge-Risk Summary Rules

`merge_risk_summary` is a reduced view of merge-risk conditions:

- `hard_fail`: number of `hard_fail` conditions
- `block`: number of `block` conditions
- `warning`: number of `warning` conditions
- `top_conditions`: up to three unique condition codes, ordered by severity first, then code

When `scripts/ops/merge-risk.ts` is available in the base branch, the execution-state report should reuse that logic. Until that dependency is present, the execution-state script uses a read-only fallback that preserves the same condition-code semantics for manifest-only checks.

## Proof Readiness Rules

Proof readiness is lane-local and read-only:

- `required_artifacts` is derived from manifest proof declarations and tier rules
- `present_artifacts` is the subset currently observable
- `ready` is `true` only when every required artifact is present

Tier rules implemented in `v1`:

| Tier | Required artifacts |
|---|---|
| `T1` | manifest proof paths, falling back to default proof path when absent, plus `pnpm test:db` |
| `T2` | manifest proof paths only |
| `T3` | manifest proof paths only |

This keeps the report observational. It does not attempt to re-grade proof content; it only reports artifact presence.

## Source Of Truth

`source_of_truth` must point to:

- manifest directory path used by `readAllManifests()`
- Linear workspace base URL for issue links
- GitHub repository base URL

Each `LaneSummary.source_url` is the Linear issue URL for that lane.

## Read-Only Contract

The producer script must not:

- write or update manifest files
- write any output file by default
- mutate in-memory manifest inputs
- call Linear mutation APIs
- create or edit GitHub PRs
- push commits or branches

The script may read manifest files and emit JSON to stdout.
