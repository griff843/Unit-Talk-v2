# PR Review Packet Schema

- Schema version: `v1`
- Purpose: standardized PR review packet for governance review before merge decisions

## Fields

- `issue_id: string`
  The Linear or tracking issue id associated with the lane manifest.
- `pr_number: number`
  The GitHub pull request number.
- `pr_url: string`
  The canonical GitHub pull request URL.
- `title: string`
  The pull request title.
- `branch: string`
  The PR head branch name.
- `tier: string`
  The effective tier, sourced from a `tier:T*` PR label when present and otherwise from the lane manifest.
- `tier_label_present: boolean`
  Whether the PR currently includes a `tier:T1`, `tier:T2`, or `tier:T3` label.
- `file_scope_summary: string[]`
  Sorted list of changed files reported by the PR.
- `tier_c_paths: string[]`
  Subset of changed files that touch Tier C governance paths: `packages/domain/`, `packages/config/`, or `supabase/migrations/*.sql`.
- `scope_bleed: string[]`
  Subset of changed files that fall outside the lane manifest `file_scope_lock`.
- `r_level_compliance: { status: 'PASS' | 'FAIL' | 'UNKNOWN'; reason: string }`
  Summary of the `scripts/ci/r-level-check.ts` result, including a short reason or first parsed output line.
- `proof_artifact_checklist: Array<{ artifact: string; present: boolean }>`
  Sorted checklist of manifest `expected_proof_paths` with presence status.
- `ci_status_summary: Array<{ name: string; status: 'pass' | 'fail' | 'pending' }>`
  Normalized summary of PR status checks.
- `merge_order_notes: string`
  Merge-order note copied from lane manifest `notes`, or an empty string when absent.
- `missing_tier_label: boolean`
  True when no `tier:T1`, `tier:T2`, or `tier:T3` PR label is present.
- `missing_proof: boolean`
  True when any expected proof artifact is absent.

## Example

```json
{
  "issue_id": "UTV2-971",
  "pr_number": 701,
  "pr_url": "https://github.com/unit-talk/unit-talk-v2/pull/701",
  "title": "feat(ops): UTV2-971 standardized PR review packet generator",
  "branch": "codex/utv2-971-generate-standardized-pr-review-packets",
  "tier": "T2",
  "tier_label_present": true,
  "file_scope_summary": [
    "docs/05_operations/schemas/pr-review-packet-v1.md",
    "scripts/ops/pr-review-packet.test.ts",
    "scripts/ops/pr-review-packet.ts"
  ],
  "tier_c_paths": [],
  "scope_bleed": [],
  "r_level_compliance": {
    "status": "PASS",
    "reason": "Verdict: PASS"
  },
  "proof_artifact_checklist": [
    {
      "artifact": "docs/06_status/proof/UTV2-971/diff-summary.md",
      "present": true
    },
    {
      "artifact": "docs/06_status/proof/UTV2-971/verification.log",
      "present": true
    }
  ],
  "ci_status_summary": [
    {
      "name": "lint",
      "status": "pass"
    },
    {
      "name": "type-check",
      "status": "pass"
    }
  ],
  "merge_order_notes": "Must merge after PR #688 (UTV2-969).",
  "missing_tier_label": false,
  "missing_proof": false
}
```

## Notes

- Tier C detection is path-based and flags any changed file under `packages/domain/`, `packages/config/`, or any `.sql` file under `supabase/migrations/`.
- Scope bleed detection compares each changed file against the lane manifest `file_scope_lock`. Any unmatched file is emitted in `scope_bleed` for governance review.
