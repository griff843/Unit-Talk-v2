# Governed Execution Loop — Implementation Specification

> **Status:** Draft — ratification patch applied 2026-04-13 (fail-closed upgrade)
> **Author:** Claude (adversarial audit + build spec)
> **Date:** 2026-04-13
> **Scope:** Phase 0 (protocol discipline) + Phase 1 (GitHub-native verification)
> **Deferred:** Auto-dispatch, bridge service, orchestration, ChatGPT-as-authority

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Phase 0 — Protocol Layer](#2-phase-0--protocol-layer)
3. [Phase 1 — Verification Layer](#3-phase-1--verification-layer)
4. [Governance Safeguards](#4-governance-safeguards)
5. [File-Level Change Manifest](#5-file-level-change-manifest)
6. [Non-Negotiables](#6-non-negotiables)
7. [Failure Modes](#7-failure-modes)
8. [Explicitly Deferred](#8-explicitly-deferred)
9. [Rollout Sequence](#9-rollout-sequence)

---

## 1. Architecture

### Design Principle

No new services. No new infrastructure. Extend what exists: Linear templates, GitHub Actions, `ut-cli` commands, PR comments. Every control must be enforceable by a tool that already runs in CI or can be added as a single workflow file.

### Layers

```
Layer 0 — Protocol (manual, enforced by discipline + skills)
  ├── Linear issue template with required metadata
  ├── Executor comment schema (versioned, machine-parseable)
  ├── PM verdict schema (versioned, machine-parseable)
  ├── Corrected state model in Linear
  └── ut-cli dispatch-check command

Layer 1 — Verification (GitHub Actions, hard gates)
  ├── executor-result-validator.yml  — parse + cross-check executor claims
  ├── merge-gate.yml                 — tier-aware merge authorization
  └── ut-cli proof-check extension   — SHA-bound proof validation
```

### What Does NOT Exist

No bridge service. No webhook router. No state machine process. No ChatGPT API calls. The human PM reads structured comments and applies labels. Tools verify claims independently.

### Compatibility

- Existing `ci.yml` unchanged — still the primary CI gate
- Existing `proof-coverage-guard.yml` unchanged — still enforces live-DB proof for runtime paths
- Existing `linear-auto-close.yml` unchanged — still closes Linear on merge with close-intent markers
- Existing `ut-cli` commands unchanged — new commands extend, not replace
- Existing `.github/CODEOWNERS` unchanged
- Existing PR template extended, not replaced

---

## 2. Phase 0 — Protocol Layer

### 2A. Linear Issue Template

Every issue entering `Ready` must have these fields populated. Issues missing any required field are moved to `Blocked` with label `blocked:missing-metadata`.

#### Required Fields

| Field | Location | Format | Set By | Validation |
|---|---|---|---|---|
| **Title** | Issue title | `UTV2-###: <imperative summary>` | PM or author | Non-empty |
| **Tier** | Label | Exactly one of: `T1`, `T2`, `T3` | **Human PM only** | Reject if missing or multiple |
| **Lane** | Label | Exactly one of: `lane:claude`, `lane:codex` | PM or orchestrator | Reject if missing |
| **Acceptance Checklist** | Description section | Markdown checklist, each item testable | PM or author | Reject if empty or vague |
| **Proof Requirement** | Description section | Explicit statement of what constitutes proof | PM or author | Reject if missing |
| **Scope Boundaries** | Description section | Explicit list of what is NOT allowed | PM or author | Reject if missing |
| **File Scope** | Description section | Explicit list of allowed files/globs | PM or author | Reject if missing for T1/T2 |
| **Dependencies** | Description section | List of blocking issue IDs, or `None` | PM or author | Must be explicit |
| **Merge Gate** | Description section | Who approves merge (PM label / orchestrator) | Derived from tier | Auto-set |

#### Issue Description Template

```markdown
## Acceptance Criteria

- [ ] <testable criterion 1>
- [ ] <testable criterion 2>
- [ ] <testable criterion 3>

## Proof Requirement

<!-- What counts as proof this is done? Be specific. -->
<!-- T1: evidence bundle with runtime proof -->
<!-- T2: diff summary + verification log -->
<!-- T3: green CI on merge SHA -->

<proof requirement here>

## Scope Boundaries

### Allowed Files
- `<path/glob>`
- `<path/glob>`

### Explicitly Excluded
- <what this issue must NOT touch>
- <what this issue must NOT change>

## Dependencies

- <UTV2-### or "None">

## Merge Gate

- <T1: PM label `t1-approved` required>
- <T2: PM PR approval required>
- <T3: orchestrator on green CI>

## Notes

<optional context>
```

#### Blocking Rule

An issue in `Ready` without all required fields is not eligible for execution. The executor (Claude or Codex) must check metadata completeness before starting work. If incomplete:

1. Do not start the lane
2. Add label `blocked:missing-metadata`
3. Post a comment identifying which fields are missing
4. Move issue to `Blocked`

This is enforced by discipline in Phase 0 and by `ut-cli dispatch-check` once implemented.

---

### 2B. Executor Comment Schema

Posted by the executor (Claude or Codex) on the **PR** when work is complete and ready for review.

#### Schema: `executor-result/v1`

```markdown
---
EXECUTOR_RESULT: READY_FOR_REVIEW
schema: executor-result/v1
---

**Issue:** UTV2-###
**Lane:** claude | codex
**Tier:** T1 | T2 | T3
**Branch:** claude/utv2-###-slug | codex/utv2-###-slug
**PR:** #NNN

## Acceptance Checklist

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | <verbatim from issue> | DONE / PARTIAL / SKIPPED | <file path, test name, or proof ref> |
| 2 | <verbatim from issue> | DONE / PARTIAL / SKIPPED | <file path, test name, or proof ref> |

## Proof Artifacts

| Type | Path | SHA Binding |
|------|------|-------------|
| CI | GitHub Actions run | <run URL> |
| Runtime proof | <file path> | <commit SHA referenced in file> |
| Evidence bundle | <file path> | <commit SHA referenced in file> |
| Verification log | <file path or inline> | <commit SHA> |

## Scope Compliance

- Files touched: <count>
- Out-of-scope files: none | <list with justification>
- Forbidden files touched: none

## Known Gaps

- <gap description and rationale, or "None">

## Verification Commands Run

```bash
pnpm type-check  # exit 0
pnpm test         # exit 0 (N/N pass)
pnpm test:db      # exit 0 | skipped (T3)
```
```

#### Parsing Rules

The comment is valid if and only if ALL of the following are true:

1. First non-blank line after frontmatter delimiters contains `EXECUTOR_RESULT: READY_FOR_REVIEW`
2. `schema: executor-result/v1` is present in the frontmatter block
3. `**Issue:**` field matches `UTV2-\d+` pattern
4. `**Tier:**` field matches exactly `T1`, `T2`, or `T3`
5. `**PR:**` field matches `#\d+` and equals the PR number where the comment is posted
6. `## Acceptance Checklist` section has a table with at least one row
7. Every checklist row has Status of exactly `DONE`, `PARTIAL`, or `SKIPPED`
8. No row has Status `SKIPPED` without a non-empty Evidence cell
9. `## Proof Artifacts` section has at least one row
10. `## Known Gaps` section exists (may contain "None")

#### Rejection Rules

A comment that fails any parsing rule is **ignored** by the merge-gate. The executor must fix and repost. An invalid executor result does not advance the issue.

#### What This Schema Does NOT Do

It does not certify work as done. It is a **structured claim** that the merge-gate and PM independently verify. The executor saying "DONE" means nothing until the gate confirms CI, proof artifacts, and PM approval independently.

---

### 2C. PM Verdict Schema

Posted by the human PM on the **PR** after reviewing the executor result and the actual diff.

#### Schema: `pm-verdict/v1` — Approved

```markdown
---
PM_VERDICT: APPROVED
schema: pm-verdict/v1
---

**Issue:** UTV2-###
**Reviewer:** @griff843
**Date:** YYYY-MM-DD

## Checks Verified

- [x] Scope aligned with issue
- [x] Acceptance criteria met
- [x] CI green on head SHA
- [x] Proof artifacts present and SHA-bound
- [x] No governance drift detected
- [x] No out-of-scope changes

## Notes

<optional — brief observations>
```

#### Schema: `pm-verdict/v1` — Changes Required

```markdown
---
PM_VERDICT: CHANGES_REQUIRED
schema: pm-verdict/v1
---

**Issue:** UTV2-###
**Reviewer:** @griff843
**Date:** YYYY-MM-DD
**Bounce:** 1 | 2

## Required Changes

1. **<specific, actionable change>**
   - File: `<path>`
   - What: <exact description of what must change>

2. **<specific, actionable change>**
   - File: `<path>`
   - What: <exact description of what must change>

## Acceptance Items Still Failing

| # | Criterion | Issue |
|---|-----------|-------|
| 2 | <criterion text> | <why it fails> |

## Next Steps

1. <concrete action>
2. <concrete action>
3. Re-post executor result when fixed
```

#### Validity Rules

A PM verdict is valid if and only if:

1. `PM_VERDICT:` is `APPROVED` or `CHANGES_REQUIRED` (no other values)
2. `schema: pm-verdict/v1` present
3. `**Issue:**` matches the PR's linked issue
4. `**Reviewer:**` is a GitHub handle matching CODEOWNERS
5. `**Date:**` is present and parseable
6. If `CHANGES_REQUIRED`: at least one item in `## Required Changes`, each with a File and What line
7. If `CHANGES_REQUIRED`: `**Bounce:**` field is present with a number
8. If `APPROVED`: all checkboxes in `## Checks Verified` are checked (`[x]`)

#### Rejection Rules

A verdict missing any required field is not valid. The merge-gate ignores invalid verdicts. Only the most recent valid verdict on a PR is authoritative.

#### PM Verdict Authorization (MANDATORY)

A valid PM verdict MUST:

- Match schema `pm-verdict/v1` exactly (all parsing rules in section 2C)
- Be posted by an **AUTHORIZED** GitHub user listed in `.github/CODEOWNERS`
- Not be posted by a bot account, automation, or the executor agent

**Invalid Conditions — verdict MUST be ignored if:**

- Posted by a user not in CODEOWNERS
- Posted by a bot account (GitHub user type `Bot`)
- Schema version is unknown or missing
- Any required field is absent or malformed

The `merge-gate.yml` MUST verify the comment author against the CODEOWNERS list. Invalid verdicts are silently ignored — they do not count as approval or rejection.

#### Bounce Limit

If `**Bounce:**` reaches `3`, the issue is moved to `Failed` with labels `needs-reframe` and `pm-triage`. The PM must manually triage — either close, re-scope, or reassign.

---

### 2D. State Model

#### States

| State | Definition | Who Enters | TTL | Exit |
|---|---|---|---|---|
| **Backlog** | Issue exists, not ready for execution | Anyone | None | PM moves to Ready |
| **Ready** | All metadata complete, eligible for dispatch | PM | None | Executor starts lane |
| **Dispatched** | System assigned, executor not yet acknowledged | Orchestrator / discipline | 10 min | Executor posts EXECUTOR_ACK |
| **In Build** | Executor actively working | Executor | 24 hours | Executor posts EXECUTOR_RESULT on PR |
| **Ready for Review** | Executor claims complete, awaiting PM | Executor result comment | 48 hours | PM posts PM_VERDICT |
| **Changes Requested** | PM rejected, executor must fix | PM verdict comment | 24 hours | Executor re-posts EXECUTOR_RESULT |
| **Approved** | PM approved, merge authorized | PM verdict comment | 4 hours | Merge to main |
| **Done** | Merged, truth-check passed | `linear-auto-close` or `ops:lane:close` | Terminal | — |
| **Blocked** | Interrupted, needs triage | Anyone | None | Blocker resolved |
| **Failed** | Retry cap exceeded or unrecoverable | System or PM | Terminal | PM triages: re-scope, close, or reassign |

#### Executor Acknowledgement Schema (MANDATORY)

When an issue enters `Dispatched`, the executor MUST post an acknowledgement comment on the Linear issue within the TTL window:

```markdown
EXECUTOR_ACK: RECEIVED
schema: executor-ack/v1
Issue: UTV2-###
Lane: claude | codex
Timestamp: 2026-04-13T14:30:00Z
```

**Rules:**
- MUST be posted within 10 minutes of entering `Dispatched`
- If missing after TTL: issue returns to `Ready`, label `dispatch:failed` applied
- If executor cannot start (blocker discovered): post `EXECUTOR_ACK: BLOCKED` with reason instead
- Only one ACK per dispatch cycle. Re-dispatch requires a new ACK.

In Phase 0, this is enforced by discipline. In Phase 1, the `stale-lane-check.yml` action detects missing ACKs.

#### Allowed Transitions

```
Backlog → Ready
Ready → Dispatched → In Build → Ready for Review → Approved → Done
                                Ready for Review → Changes Requested → In Build
                                                                    (max 2 bounces)
                                                   Changes Requested → Failed (bounce 3)

Any active state → Blocked (explicit blocker)
Blocked → previous state (blocker resolved)

In Build → Failed (executor gives up or 24h TTL)
Changes Requested → Failed (24h TTL or bounce 3)
Dispatched → Ready (10 min TTL, no EXECUTOR_ACK received)

Done → Reopened (truth-check failure post-merge)
Reopened → In Build
```

#### Failed State Behavior (MANDATORY)

When an issue enters `Failed`, the following MUST occur:

1. **Labels applied:**
   - `needs-reframe` — indicates the issue scope or approach needs human revision
   - `pm-triage` — signals PM must act before any re-entry to workflow

2. **Exit conditions — issue CANNOT re-enter the workflow until:**
   - Human PM updates the scope, acceptance criteria, or approach, OR
   - A replacement issue is created with corrected scope, OR
   - PM explicitly re-queues by removing `needs-reframe` + `pm-triage` labels and moving to `Ready`

3. **What MUST NOT happen:**
   - Executor cannot self-recover from `Failed` — only a human can
   - No automation may move an issue out of `Failed`
   - Re-entering `Ready` from `Failed` without PM action is a governance violation

`Failed` is a terminal state that requires human judgment. It exists to prevent infinite retry loops and to force scope correction when an approach is not working.

#### State TTL Enforcement (MANDATORY)

All active states MUST have enforced TTLs. A TTL without an enforcement mechanism is INVALID governance — it is a suggestion, not a control.

| State | TTL | Action on Expiry | Label Applied |
|---|---|---|---|
| **Dispatched** | 10 min | Return to `Ready` | `dispatch:failed` |
| **In Build** | 24 hours | Move to `Failed` | `needs-triage` |
| **Ready for Review** | 48 hours | Notify PM, flag stale | `review:stale` |
| **Changes Requested** | 24 hours | Move to `Failed` | `needs-triage` |
| **Approved** | 4 hours | Notify PM (merge overdue) | `merge:overdue` |

**Phase 0 enforcement:** PM checks Linear daily. This is the minimum viable enforcement — acceptable only during the Phase 0 observation period.

**Phase 1 enforcement (MANDATORY):** `stale-lane-check.yml` GitHub Action runs on a cron schedule:
- Every 15 minutes for `Dispatched` TTL (10 min window)
- Every 4 hours for all other states

The action MUST:
1. Query Linear API for issues in active states
2. Compare `state_changed_at` against TTL thresholds
3. Apply the specified label if TTL exceeded
4. Post a comment on the Linear issue identifying the TTL breach
5. For `In Build` and `Changes Requested` TTL breaches: move to `Failed`
6. For `Dispatched` TTL breaches: move back to `Ready`

**TTL without enforcement = governance theater.** Phase 1 completion is not valid until this action is running.

#### Who Moves States

| Transition | Actor |
|---|---|
| → Ready | Human PM |
| → Dispatched | Orchestrator (Claude) or PM |
| → In Build | Executor (first commit / ack) |
| → Ready for Review | Executor (EXECUTOR_RESULT comment) |
| → Changes Requested | PM (PM_VERDICT: CHANGES_REQUIRED) |
| → Approved | PM (PM_VERDICT: APPROVED) |
| → Done | `linear-auto-close.yml` on merge, or `ops:lane:close` |
| → Blocked | Anyone (with reason) |
| → Failed | PM or system (bounce limit / unrecoverable) |
| Tier assignment | **Human PM only — never executor** |

---

## 3. Phase 1 — Verification Layer

### 3A. GitHub Action: `executor-result-validator.yml`

**Purpose:** When a PR comment matches the executor-result schema, independently verify the claims.

**Trigger:** `issue_comment` event on PRs (comment created or edited).

**Does NOT trust:** Anything in the executor comment. Verifies independently.

#### Workflow Spec

```yaml
name: Executor Result Validator

on:
  issue_comment:
    types: [created, edited]

jobs:
  validate-executor-result:
    name: Validate executor completion claim
    if: >-
      github.event.issue.pull_request &&
      contains(github.event.comment.body, 'EXECUTOR_RESULT: READY_FOR_REVIEW') &&
      contains(github.event.comment.body, 'schema: executor-result/v1')
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      checks: write
      contents: read

    steps:
      # 1. Parse the comment
      - name: Parse executor result
        id: parse
        # Extract fields using grep/sed:
        # - Issue ID from **Issue:** field
        # - Tier from **Tier:** field
        # - PR number from **PR:** field
        # - Proof artifact paths from ## Proof Artifacts table
        # - Acceptance checklist statuses
        # - Known gaps
        # Validate all parsing rules (2B above)
        # Output: parsed JSON with all fields, or error

      # 2. Verify PR number matches
      - name: Verify PR self-reference
        # Comment's **PR:** field must match the PR number
        # where the comment was posted

      # 3. Verify branch naming convention
      - name: Check branch name
        # PR head branch must match:
        #   claude/utv2-<NNN>-* or codex/utv2-<NNN>-*
        # The lane prefix must match **Lane:** field

      # 4. Verify CI status independently via GitHub API
      - name: Check CI status
        # Use gh api to check status of head SHA:
        #   gh api repos/{owner}/{repo}/commits/{sha}/check-runs
        # Require: CI workflow conclusion == 'success'
        # Do NOT read CI status from the comment

      # 5. Verify proof artifacts exist
      - name: Checkout and verify proof paths
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.issue.pull_request.head.sha }}
      - name: Check proof files
        # For each path in ## Proof Artifacts table:
        #   - File exists at declared path
        #   - File is non-empty
        #   - File contains a SHA reference (grep for 7+ hex chars)
        # For T1: evidence bundle must match evidence_bundle_v1 structure
        # For T2: verification log must exist

      # 6. Verify acceptance checklist completeness
      - name: Check acceptance checklist
        # All rows must have Status DONE, PARTIAL, or SKIPPED
        # Any PARTIAL or SKIPPED row must have non-empty Evidence
        # No row may have empty Status

      # 7. Post check result
      - name: Post validation result
        # Create a check run on the PR:
        #   Name: "Executor Result Validation"
        #   Conclusion: success | failure
        #   Output: summary of what passed/failed
        #
        # If any check fails, post a PR comment:
        #   VALIDATION_RESULT: FAILED
        #   schema: validation-result/v1
        #   <list of failures>
        #
        # If all pass, post:
        #   VALIDATION_RESULT: PASSED
        #   schema: validation-result/v1
        #   <summary>
```

#### Failure Conditions

| Check | Failure | Consequence |
|---|---|---|
| Schema parse | Malformed comment | Ignored — no check posted |
| PR self-reference | PR number mismatch | Check: failure |
| Branch naming | Wrong prefix or no issue ID | Check: failure |
| CI status | CI not green on head SHA | Check: failure |
| Proof path | File missing or empty | Check: failure |
| Proof SHA | No SHA reference in proof file | Check: failure (T1/T2 only) |
| Acceptance | Missing or invalid status | Check: failure |

#### How It Blocks PRs

The check run `Executor Result Validation` is added to GitHub branch protection as a required check. A PR cannot merge without this check passing. The check only runs (and therefore only passes) when a valid executor result comment exists AND all independent verifications pass.

---

### 3B. GitHub Action: `merge-gate.yml`

**Purpose:** Enforce tier-appropriate merge authorization. Prevent merge without proper approval.

**Trigger:** `pull_request_review`, `pull_request` (labeled/unlabeled/synchronize), `check_suite` completed.

#### Workflow Spec

```yaml
name: Merge Gate

on:
  pull_request:
    types: [labeled, unlabeled, synchronize, ready_for_review]
  pull_request_review:
    types: [submitted]
  check_suite:
    types: [completed]

jobs:
  merge-gate:
    name: Tier-aware merge authorization
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
      checks: write
      contents: read

    steps:
      # 1. Detect tier from PR labels
      - name: Detect tier
        id: tier
        # Look for exactly one of: T1, T2, T3 label on the PR
        # If no tier label: check = neutral (not applicable, skip)
        # If multiple tier labels: check = failure

      # 2. Check for PM verdict comment
      - name: Find PM verdict
        id: verdict
        # Scan PR comments for most recent valid PM_VERDICT
        # Parse per schema pm-verdict/v1
        # Extract: verdict type, reviewer, bounce count

      # 3. Tier-specific authorization
      - name: Evaluate merge authorization
        id: auth
        # T1:
        #   Required: label 't1-approved' on PR
        #   Required: PM_VERDICT: APPROVED comment from CODEOWNERS member
        #   Required: GitHub PR review approval from CODEOWNERS member
        #   → All three must be present
        #
        # T2:
        #   Required: PM_VERDICT: APPROVED comment from CODEOWNERS member
        #   Required: GitHub PR review approval from CODEOWNERS member
        #   → Both must be present
        #
        # T3:
        #   Required: Executor Result Validation check = success
        #   Required: CI check = success
        #   → Auto-mergeable if both pass (no PM verdict required)
        #   → PM_VERDICT: APPROVED is accepted but not required

      # 4. Post check result
      - name: Post merge gate result
        # Create check run "Merge Gate":
        #   T1 without t1-approved label → failure
        #   T1/T2 without PM_VERDICT: APPROVED → failure
        #   T3 without CI green → failure
        #   All conditions met → success
```

#### Tier Detection

The tier is read from PR labels, not from executor comments. Labels are set by the human PM on the Linear issue and synced to the PR (or applied directly). The executor cannot set or change tier labels.

If no tier label exists on the PR, the merge gate posts a `neutral` check with message: "No tier label found. Add T1, T2, or T3 label to enable merge gate."

#### Authorization Matrix

| Tier | CI Green | Executor Result Valid | PM Verdict: APPROVED | PR Review Approval | `t1-approved` Label |
|---|---|---|---|---|---|
| T1 | Required | Required | Required | Required | **Required** |
| T2 | Required | Required | Required | Required | Not required |
| T3 | Required | Required | Not required | Not required | Not required |

#### Branch Protection Requirement (MANDATORY — Non-Negotiable)

The following checks MUST be configured as **required status checks** in GitHub branch protection for the `main` branch:

1. `CI` (existing `ci.yml`)
2. `Executor Result Validation` (from `executor-result-validator.yml`)
3. `Merge Gate` (from `merge-gate.yml`)
4. Required reviews: minimum 1 for T1/T2 PRs (enforced by CODEOWNERS)

**Without branch protection configured, governance is advisory only and the system is NOT valid.** This is not a recommendation — it is a prerequisite. Phase 1 is not complete until branch protection is enabled with these required checks.

Step 1.3 in the rollout sequence is blocking. Steps 1.4–1.6 cannot proceed without it.

---

### 3C. Proof Verification Strategy

#### Structure

Proof artifacts follow the existing `EVIDENCE_BUNDLE_TEMPLATE.md` for all tiers. (The earlier `PROOF_BUNDLE_SCHEMA.md` is historical only — superseded by `EVIDENCE_BUNDLE_TEMPLATE.md` as of UTV2-532.) No new format is introduced.

#### Storage

| Tier | Proof Location | Format |
|---|---|---|
| T1 | `docs/06_status/UTV2-###-EVIDENCE-BUNDLE.md` | Evidence bundle v1 (7 required sections) |
| T2 | `docs/06_status/proof/UTV2-###-verify.md` or inline in executor result | Verification log with SHA reference |
| T3 | CI run URL | No file artifact required |

#### SHA Binding

Every proof file must contain the merge commit SHA or the PR head SHA. This is validated by:

1. **Phase 0:** Executor self-reports SHA in `## Proof Artifacts` table (discipline)
2. **Phase 1:** `executor-result-validator.yml` greps proof files for the SHA and confirms match against `github.event.pull_request.head.sha`
3. **Existing:** `ops:truth-check` P3 check validates `manifest.commit_sha` appears in proof files (post-merge)

#### Validation Mechanism

Proof is validated at three levels:

| Level | When | Tool | What It Checks |
|---|---|---|---|
| Pre-merge | PR comment posted | `executor-result-validator.yml` | File exists, non-empty, contains SHA |
| Pre-merge | PM review | Human PM reads proof | Content quality, completeness |
| Post-merge | Lane close | `ops:truth-check` P1–P10 | Full proof schema validation, SHA binding, staleness |

#### What Is NOT Accepted As Proof

- Executor saying "proof exists" without a file path
- A proof file that does not reference the merge SHA
- A proof file with `mtime` before the merge commit timestamp
- An evidence bundle with placeholder text (`TODO`, `TBD`, `<fill-in>`)
- An evidence bundle where `verifier.identity` equals the implementing agent's lane identity
- CI passing on a branch that was never merged

---

### 3D. Proof Contract (MANDATORY)

Every implementation requiring proof MUST include a proof artifact file. This is not optional. Proof without this structure is invalid.

#### Required Proof File Structure

```markdown
# PROOF: UTV2-###
MERGE_SHA: <exact PR head SHA>

ASSERTIONS:
- [ ] <verifiable assertion 1>
- [ ] <verifiable assertion 2>

EVIDENCE:
```text
<command output / logs / test results>
```
```

For T1 issues, this is in addition to the full evidence bundle (which follows `EVIDENCE_BUNDLE_TEMPLATE.md`). For T2, this structure may serve as the primary proof artifact. T3 requires no file artifact — green CI is sufficient.

#### Proof Validation Rules (MANDATORY)

A proof artifact is VALID if and only if ALL of the following hold:

1. File exists at the path declared in the executor result `## Proof Artifacts` table
2. File contains `# PROOF:` header matching the issue ID
3. File contains `MERGE_SHA:` field
4. `MERGE_SHA` value EXACTLY matches the current PR head SHA (verified by `executor-result-validator.yml`, not by executor self-report)
5. `ASSERTIONS:` section exists with at least one checklist item
6. `EVIDENCE:` section exists with at least one non-empty code block
7. No placeholder content (`TODO`, `TBD`, `<fill-in>`, `FIXME`, `PLACEHOLDER`)

#### Proof Rejection Conditions (MANDATORY)

Reject proof and fail the validation check if ANY of the following are true:

- Any required section (`# PROOF:`, `MERGE_SHA:`, `ASSERTIONS:`, `EVIDENCE:`) is missing
- `MERGE_SHA` does not match PR head SHA
- `ASSERTIONS` section has zero items
- `EVIDENCE` section has zero code blocks or contains only placeholder text
- File path declared in executor result does not resolve to an existing, non-empty file
- Evidence contains only narrative claims without verifiable output (e.g., "tests passed" without stdout)

---

### 3E. CI Truth Lock (MANDATORY)

#### CI Verification (Fail-Closed)

A PR is eligible for review ONLY if:

- **ALL** required CI checks are GREEN
- Checks correspond to the **CURRENT** PR head SHA — not any previous commit

#### Explicitly Invalid CI States

The following do NOT constitute valid CI:

- CI passing on previous commits but not the current head
- Partial CI success (some checks green, others pending or failed)
- Executor-reported CI status in comment text
- CI passing on a branch that has since been force-pushed

#### Enforcement

The `executor-result-validator.yml` MUST query the GitHub API directly:

```
GET /repos/{owner}/{repo}/commits/{head_sha}/check-runs
```

It MUST verify:
- The `head_sha` matches `github.event.pull_request.head.sha` (current, not stale)
- Every required check run has `conclusion: 'success'`
- The CI workflow specifically (named `CI` in this repo) has `conclusion: 'success'`

If the API returns any non-success conclusion, or if the SHA is stale, the validation check MUST fail. There is no fallback, no override, no exception.

---

## 4. Governance Safeguards

### 4A. Anti-Self-Certification

| Rule | Enforcement |
|---|---|
| Executor cannot certify its own work as Done | `ops:truth-check` is the done-gate, not the executor comment |
| Executor result is a **claim**, not a **certification** | Merge-gate and PM independently verify |
| Proof verifier must not be the implementer | Evidence bundle P10: `verifier.identity` != implementing agent |
| CI status is read from GitHub API, not comment text | `executor-result-validator.yml` checks `gh api`, not parsed comment |
| PM verdict must come from CODEOWNERS member | `merge-gate.yml` validates commenter identity |

### 4B. Tier Enforcement

| Rule | Enforcement |
|---|---|
| Only humans assign tier labels | Documented in CLAUDE.md + delegation policy |
| Executor may escalate tier UP (T3→T2, T2→T1) | Allowed — stops work and notifies PM |
| Executor may NEVER lower tier | Documented as invariant; PM reviews label changes |
| Multiple tier labels = invalid | `merge-gate.yml` rejects; `dispatch-check` rejects |
| Missing tier label = not Ready | `dispatch-check` blocks; merge-gate returns neutral |

#### PR Tier Requirement (MANDATORY)

Every PR MUST include exactly ONE tier label on the GitHub PR itself:

- `tier:T1`
- `tier:T2`
- `tier:T3`

**Rules:**
- Tier is set by **HUMAN ONLY** — no executor, no automation, no script
- GitHub Actions (`merge-gate.yml`, `executor-result-validator.yml`) MUST read tier from **PR labels**, not from executor comments, not from Linear alone
- Linear tier label is the source of intent, but the **PR label is the enforcement point** — both must agree
- If tier label is missing from the PR, the merge-gate returns `neutral` (not applicable) — the PR cannot merge because the required check never succeeds
- If multiple tier labels exist on the PR, the merge-gate returns `failure`

### 4C. Retry / Bounce Limits

| Bounce | Action |
|---|---|
| 1 | Normal — Changes Requested → In Build → Ready for Review |
| 2 | Final attempt — PM verdict must note `Bounce: 2` |
| 3 | **Auto-block.** Issue moves to `Failed`. PM must triage: re-scope, close, or reassign to different executor. |

Bounce count is tracked in the `**Bounce:**` field of `PM_VERDICT: CHANGES_REQUIRED` comments. The merge-gate and PM are responsible for enforcing this in Phase 0. Phase 1 `merge-gate.yml` can optionally count `CHANGES_REQUIRED` verdicts on the PR to enforce mechanically.

### 4D. Strict Schema Versioning (MANDATORY)

All structured comments in this system use versioned schemas. This is not optional.

#### Schema Format Rules

Every structured comment MUST include the schema identifier as the FIRST metadata field:

**Executor result:**
```
EXECUTOR_RESULT: READY_FOR_REVIEW
schema: executor-result/v1
Issue: UTV2-###
```

**PM verdict:**
```
PM_VERDICT: APPROVED | CHANGES_REQUIRED
schema: pm-verdict/v1
Issue: UTV2-###
```

**Executor acknowledgement:**
```
EXECUTOR_ACK: RECEIVED | BLOCKED
schema: executor-ack/v1
Issue: UTV2-###
```

**Validation result (posted by GitHub Action):**
```
VALIDATION_RESULT: PASSED | FAILED
schema: validation-result/v1
```

#### Versioning Rules (MANDATORY)

1. The `schema:` line MUST appear in the frontmatter block of every structured comment
2. Unknown schema versions MUST be rejected — parsers MUST NOT guess, infer, or fall back
3. Parsers MUST NOT attempt to parse a comment without a recognized schema identifier
4. Schema version changes require a spec update to this document and parser updates to all consuming GitHub Actions
5. Old schema versions remain parseable for backwards compatibility, but new comments MUST use the latest version
6. A comment without a `schema:` line is not a structured comment — it is ignored by all automation

### 4E. Idempotency Rules (Future-Safe)

Even though no auto-dispatch exists yet, these rules are established now to prevent problems when automation is added later:

| Rule | Rationale |
|---|---|
| Before starting a lane, check for existing branch `claude/utv2-###-*` or `codex/utv2-###-*` | Prevents duplicate lanes |
| Before starting a lane, check for existing open PR with issue ID in title | Prevents duplicate PRs |
| Before starting a lane, check lane manifest for active lane on same issue | Prevents file-lock conflicts |
| One issue = one lane = one branch = one PR | Invariant from CLAUDE.md |
| If branch exists and PR is open, **resume** — do not restart | Prevents lost work |

These are enforced by `ops:preflight` (PL5: one manifest per issue) and `ops:lane:start` (branch existence check) once the lane manifest system is operational. In Phase 0, enforced by executor discipline.

### 4F. Audit Trail

| Event | Where It's Recorded | Format |
|---|---|---|
| Issue metadata set | Linear issue description + labels | Template fields |
| Lane started | Lane manifest `started_at` + `ut-state/started.json` | JSON |
| Work committed | Git history on branch | Commits |
| Executor claims complete | PR comment (EXECUTOR_RESULT) | Schema v1 |
| Validation result | PR check run + PR comment (VALIDATION_RESULT) | Schema v1 |
| PM reviews | PR comment (PM_VERDICT) | Schema v1 |
| Merge | Git merge commit on main | SHA |
| Linear state change | Linear activity log | Automatic |
| Truth-check result | Lane manifest `truth_check_history[]` | JSON |
| Lane closed | Lane manifest `closed_at` + `ut-state/closed.json` | JSON |

Every state transition is traceable to a specific actor (human handle, `claude/<session>`, `codex-cli/<lane>`, or `github-actions`) with a timestamp. No transition occurs without a written record in at least one of: Linear, GitHub, or lane manifest.

#### Audit Trail Reconstruction Requirement (MANDATORY)

The system MUST allow answering ALL of the following questions for any merged PR, using only GitHub-native artifacts:

| Question | Source of Truth |
|---|---|
| Who approved this PR? | PR review history + PM_VERDICT comment author |
| What proof existed at merge time? | Executor result comment `## Proof Artifacts` table + file in repo at merge SHA |
| What SHA was reviewed? | PM_VERDICT comment + PR merge commit |
| How many revision cycles occurred? | Count of `PM_VERDICT: CHANGES_REQUIRED` comments on the PR |
| What tier was this work? | PR labels (`tier:T1`, `tier:T2`, `tier:T3`) |
| What acceptance criteria were claimed met? | Executor result comment `## Acceptance Checklist` table |
| Was CI green at merge? | GitHub check runs on merge commit SHA |

**Source of truth for audit:** PR comments, check runs, labels, and review history. The audit MUST be reconstructable from GitHub alone — not from Linear, not from chat, not from memory, not from external systems. Linear is supplementary context, not audit evidence.

---

## 5. File-Level Change Manifest

### Phase 0 (create / update)

| Action | File | Description |
|---|---|---|
| **Create** | `docs/05_operations/GOVERNED_LOOP_SPEC.md` | This file |
| **Create** | `docs/05_operations/schemas/executor-result-v1.md` | Executor comment schema reference |
| **Create** | `docs/05_operations/schemas/pm-verdict-v1.md` | PM verdict schema reference |
| **Update** | `.github/pull_request_template.md` | Add tier, issue, and proof fields |
| **Update** | `CLAUDE.md` | Add pointer to this spec; add comment schema rules |
| **Create** | `.claude/commands/dispatch-check.md` | Skill: validate issue metadata before starting lane |

### Phase 1 (create / update)

| Action | File | Description |
|---|---|---|
| **Create** | `.github/workflows/executor-result-validator.yml` | PR comment validator action |
| **Create** | `.github/workflows/merge-gate.yml` | Tier-aware merge authorization action |
| **Create** | `.github/workflows/stale-lane-check.yml` | Daily TTL enforcement (optional) |
| **Update** | `.github/pull_request_template.md` | Add checklist item for executor result |

### NOT Changed

| File | Why |
|---|---|
| `.github/workflows/ci.yml` | Already correct. No modification needed. |
| `.github/workflows/proof-coverage-guard.yml` | Already correct. No modification needed. |
| `.github/workflows/linear-auto-close.yml` | Already correct. No modification needed. |
| `scripts/ut-cli/*` | Existing commands are correct. New commands extend. |

---

## 6. Non-Negotiables

These rules are absolute. No exception, no waiver, no "just this once."

1. **Human assigns tier.** No executor, no automation, no script may set or lower a tier label.

2. **Human approves T1/T2 merge.** T1 requires `t1-approved` label + PM verdict + PR review. T2 requires PM verdict + PR review. Bot comments are not approval.

3. **CI verification is independent.** The system checks CI status via GitHub API (`check-runs` endpoint), never by parsing executor self-reports.

4. **Idempotent dispatch.** Starting a lane when a branch/PR/manifest already exists for that issue is a no-op or resume, never a restart.

5. **Max 2 bounces.** After 2 `CHANGES_REQUIRED` cycles, the issue moves to `Failed` and requires PM triage.

6. **State TTLs.** `Dispatched`: 10 min (ACK required). `In Build`: 24h. `Ready for Review`: 48h. `Changes Requested`: 24h. `Approved`: 4h. Expiry triggers the specific action defined in the TTL table — `Dispatched` returns to `Ready`, `In Build`/`Changes Requested` move to `Failed`.

7. **No auto-merge for T1/T2.** Even with PM approval, merge is a human action for T1/T2.

8. **Audit trail.** Every state transition has a written record with actor identity and timestamp.

9. **Kill switch.** Label `governance:pause` on any issue halts all execution on that issue immediately.

10. **Schema versioning.** All comment schemas include `schema: <name>/v<N>`. Parsers reject unknown schema versions.

11. **Proof must be verifiable.** "Proof exists: yes" is not proof. The file must exist at the declared path, contain the relevant SHA, and be non-empty.

12. **No ChatGPT as sole authority.** ChatGPT may draft content. A human must ratify all advancement decisions for T1/T2.

13. **Branch protection is mandatory.** `Executor Result Validation`, `Merge Gate`, and `CI` MUST be required status checks on `main`. Without branch protection, governance is advisory — the system is not valid.

14. **Failed is human-only exit.** No executor or automation may move an issue out of `Failed`. Only a human PM can triage and re-queue.

---

## 7. Failure Modes

| Failure Mode | How This Design Prevents It |
|---|---|
| **Executor self-certifies as Done** | Executor comment is a claim. `ops:truth-check` is the done-gate. Merge-gate requires independent CI check + PM verdict. |
| **Rubber-stamp PM reviews** | PM verdict schema forces explicit checkbox verification and specific change descriptions. Bounce tracking reveals patterns. |
| **Proof fraud (claim proof exists but it doesn't)** | `executor-result-validator.yml` checks file existence and SHA content independently. `ops:truth-check` P1–P4 re-validates post-merge. |
| **Tier manipulation (downgrade to avoid review)** | Tier labels are human-only. Merge-gate reads labels, not executor claims. Executor may escalate UP but never DOWN. |
| **Bounce loop (infinite back-and-forth)** | Hard cap at 2 bounces. Bounce 3 → `Failed` state → PM triage. |
| **Stale issues (stuck in a state forever)** | TTLs on every active state. Phase 1 adds automated stale detection. |
| **Duplicate execution (two agents on same issue)** | Idempotency rules: check branch/PR/manifest before starting. `ops:lane:start` file-lock check. |
| **Linear-GitHub state divergence** | GitHub is canonical (rank 1). Linear is projection (rank 4). `linear-auto-close.yml` syncs on merge. `ops:truth-check` reconciles at close. |
| **Invalid comment blocks merge** | Invalid schemas are ignored (not failed). The check simply doesn't run. Only valid schemas trigger validation. |
| **Executor learns to game PM review** | PM reviews actual diff, not just structured comment. PM has independent access to CI, proof files, and code. |
| **Dead PR (no executor result posted)** | Without a valid EXECUTOR_RESULT, the `Executor Result Validation` check never posts success. PR cannot merge. |
| **PM unavailable** | TTL on `Ready for Review` (48h). Stale alert fires. Does not auto-approve — fails safely by stalling. |

---

## 8. Explicitly Deferred

The following are **not built** in Phase 0 or Phase 1. They are deferred until data from Phase 0/1 proves they are needed.

| Feature | Why Deferred |
|---|---|
| **Bridge / orchestrator service** | Current executor count (2) doesn't justify a coordination service. Manual dispatch works. |
| **Auto-dispatch from Linear** | Requires idempotency, crash recovery, rate limiting — real distributed systems work. Not justified yet. |
| **Dependency intelligence** | <50 active issues. Humans can see dependencies. YAGNI for 6+ months. |
| **Workload balancing** | 2 executors, max 2 Codex lanes. Nothing to balance. |
| **Automatic issue creation** | Creates issue sprawl and PM loss-of-control. Never automate without human approval. |
| **ChatGPT as final authority** | ChatGPT cannot verify proof, run tests, or read diffs. May assist drafting but never decide. |
| **Status-doc auto-sync** | PROGRAM_STATUS.md is updated at sprint close. Weekly update doesn't need automation. |
| **Notification webhooks** | PM checks Linear daily. Structured comments make review faster. Add notifications only if review latency proves problematic. |

---

## 9. Rollout Sequence

### Phase 0 — Immediate (this week)

**Goal:** Establish protocol discipline without any automation.

| Step | Action | Blocking? |
|---|---|---|
| 0.1 | Ratify this spec (PM reads, confirms, or requests changes) | Yes |
| 0.2 | Add Linear issue template fields to all `Ready` issues | No — progressive |
| 0.3 | Update `.github/pull_request_template.md` with tier/issue/proof fields | No |
| 0.4 | Start using executor comment schema on all new PRs | No — progressive |
| 0.5 | Start using PM verdict schema on all new PR reviews | No — progressive |
| 0.6 | Apply Linear state model (add `Dispatched`, `Failed` states if needed) | No |
| 0.7 | Update `CLAUDE.md` with pointer to this spec | No |

**Success criteria for Phase 0:** 5+ PRs using both schemas correctly, with no false positives or friction that slows production.

### Phase 1 — Weeks 2-3 (after schemas prove stable)

**Goal:** Mechanical enforcement of what Phase 0 proved manually.

| Step | Action | Blocking? |
|---|---|---|
| 1.1 | Ship `executor-result-validator.yml` | T2 lane |
| 1.2 | Ship `merge-gate.yml` | T2 lane |
| 1.3 | Add both as required checks in GitHub branch protection | PM action |
| 1.4 | Ship `stale-lane-check.yml` (optional, daily cron) | T3 lane |
| 1.5 | Run for 1 week with checks in **advisory mode** (report but don't block) | Observation period |
| 1.6 | Flip checks to **required** after advisory period | PM decision |

**Success criteria for Phase 1:** 2 weeks of enforced checks with zero false-positive merge blocks and zero governance bypasses.

### Phase 2 — Deferred (month 2+, data-driven decision)

Only proceed if Phase 0/1 data shows:
- Manual dispatch is the bottleneck (not PM review or issue quality)
- Current throughput is limited by coordination, not execution capacity
- The schemas are stable and parsers are reliable

---

## Appendix: Updated PR Template

```markdown
## Summary

-

## Linked Issue

- UTV2-###

## Tier

- T1 | T2 | T3

## Files Changed

-

## Contracts Touched

-

## Risks

-

## Proof Artifacts

- <!-- path to proof file, evidence bundle, or "CI only (T3)" -->

## Verification

- [ ] `pnpm env:check`
- [ ] `pnpm lint`
- [ ] `pnpm type-check`
- [ ] `pnpm build`
- [ ] `pnpm test`
- [ ] `pnpm test:db` (T1 required, T2 if runtime, T3 skip)
- [ ] Executor result comment posted (executor-result/v1)
- [ ] Proof artifacts present and SHA-bound
```
