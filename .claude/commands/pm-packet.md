# /pm-packet

Generate a structured PM review packet for a PR. Produces machine-readable output that can be handed to ChatGPT or a human PM for verdict decisions.

**Usage:** `/pm-packet UTV2-###` or `/pm-packet <PR-number>`

---

## What this skill does

1. Identify the PR and associated lane manifest
2. Collect all review-relevant data
3. Output a structured JSON packet suitable for PM review

---

## Data collection steps

### Step 1: Resolve the target

If given an issue ID (UTV2-###):
- Read the lane manifest at `docs/06_status/lanes/UTV2-###.json`
- Extract `pr_url` from the manifest
- Extract tier, file_scope_lock, expected_proof_paths

If given a PR number:
- Run `gh pr view <number> --json number,title,url,headRefName,mergeCommit,state,labels,changedFiles,additions,deletions,body`
- Parse the issue ID from the branch name

### Step 2: Collect diff summary

Run:
```bash
gh pr diff <number> --stat
```

Capture the diffstat output (files changed, insertions, deletions).

### Step 3: Collect CI status

Run:
```bash
gh pr checks <number>
```

Report pass/fail/pending for each check.

### Step 4: Collect proof artifacts

If the PR branch or merge commit contains proof files at `expected_proof_paths`:
- List them
- For each: check if it references the merge SHA
- Report proof coverage (complete / partial / missing)

### Step 5: Assess risk

Based on:
- **Tier**: T1 = high, T2 = medium, T3 = low
- **Sensitive paths touched**: check against DELEGATION_POLICY.md sensitive-path matrix
  - `supabase/migrations/**` = critical
  - `packages/domain/src/**` = critical
  - `packages/contracts/src/**` = critical
  - `packages/db/src/**` = critical
  - `apps/api/src/distribution-service.ts` = critical
- **Scope compliance**: are all changed files within `file_scope_lock`?

### Step 6: Generate recommended verdict

- If tier=T3 and CI green: recommend `APPROVED`
- If tier=T2 and CI green and no sensitive paths: recommend `APPROVED`
- If tier=T2 and sensitive paths touched: recommend `REVIEW_REQUIRED`
- If tier=T1: always recommend `REVIEW_REQUIRED` (never auto-approve T1)
- If CI not green: recommend `CHANGES_REQUIRED`

---

## Output format

Emit this JSON to stdout:

```json
{
  "schema": "pm-review-packet/v1",
  "generated_at": "ISO-8601",
  "issue_id": "UTV2-###",
  "pr": {
    "number": 123,
    "title": "...",
    "url": "...",
    "state": "open|merged",
    "branch": "claude/utv2-###-...",
    "labels": ["t2", "..."]
  },
  "tier": "T1|T2|T3",
  "diff_summary": {
    "files_changed": 5,
    "insertions": 120,
    "deletions": 30,
    "diffstat": "... (full diffstat output)"
  },
  "ci_status": {
    "overall": "pass|fail|pending",
    "checks": [
      { "name": "CI", "status": "pass" }
    ]
  },
  "proof": {
    "coverage": "complete|partial|missing|not_required",
    "artifacts": ["path/to/proof.json"],
    "sha_bound": true
  },
  "risk_assessment": {
    "level": "critical|high|medium|low",
    "sensitive_paths_touched": ["packages/domain/src/scoring.ts"],
    "scope_compliant": true,
    "flags": ["touches domain logic", "migration present"]
  },
  "recommended_verdict": "APPROVED|REVIEW_REQUIRED|CHANGES_REQUIRED",
  "verdict_reason": "T2, CI green, no sensitive paths, scope compliant"
}
```

---

## Rules

- This skill is **read-only**. It collects data and generates a packet. It does NOT post verdicts, merge PRs, or modify any state.
- The recommended verdict is a **suggestion**, not an action. The human PM makes the final call.
- For T1 issues, always include the note: "T1 requires human PM review of proof artifacts. ChatGPT may draft but must not decide."
- If the manifest is missing or the PR cannot be found, report what is available and note what is missing.
- Always include the raw diffstat so the PM can see the scope at a glance.
