## 1. Purpose

This document standardizes the reusable workflow skill registry for Unit Talk V2.

## 2. Existing Skill Inventory (.agents/skills/)

Existing `.agents/skills/` files do not declare a uniform owner/category/trigger schema. The `Category`, `Owner`, and `Trigger` fields below are inventory classifications inferred from each file's frontmatter and opening instructions; the underlying files remain authoritative as-is.

| Filename | Category | Owner | Trigger | Description |
|---|---|---|---|---|
| `.agents/skills/betting-domain/SKILL.md` | implementation | `codex-implementation` | Before changing `packages/contracts`, `packages/domain`, CanonicalPick, promotion scores, lifecycle rules, or grading | Guards domain and contract changes; keeps pure-domain invariants intact. |
| `.agents/skills/branch-hygiene/SKILL.md` | governance | `codex-implementation` | When repo state is mixed, splitting work, staging slices, merging finished branches, or pruning stale branches | Keeps branch, worktree, and staging state clean. |
| `.agents/skills/db-verify/SKILL.md` | verification | `codex-implementation` | After DB-writing changes or when runtime and persistence truth may disagree | Verifies live DB truth after implementation. |
| `.agents/skills/dispatch/SKILL.md` | governance | `codex-implementation` | Manual dispatch requests, queue dispatch, or one-command Codex execution from Linear | Runs the Codex-native dispatch workflow. |
| `.agents/skills/doc-truth-audit/SKILL.md` | review | `codex-implementation` | When auditing docs that claim `metadata.domainAnalysis` runtime consumers or producers | Audits documentation truth claims for `metadata.domainAnalysis`. |
| `.agents/skills/doc-truth-audit/check-doc-truth.ps1` | verification | `codex-implementation` | Invoked with `DocPath` during a doc truth audit | PowerShell helper used to normalize paths and validate doc-truth evidence. |
| `.agents/skills/frontend-design/SKILL.md` | implementation | `codex-implementation` | When building frontend components, pages, or applications | Guides distinctive, production-grade frontend implementation. |
| `.agents/skills/linear-execution/SKILL.md` | governance | `codex-implementation` | When work explicitly depends on Linear issue or lane state | Uses the repo's CLI-first Linear workflow. |
| `.agents/skills/merge-conflict-resolution/SKILL.md` | implementation | `codex-implementation` | When a merge stops on a real conflict | Resolves merge conflicts while preserving valid behavior. |
| `.agents/skills/operator-surface/SKILL.md` | implementation | `codex-implementation` | When touching operator snapshots, pick detail/search views, command-center actions, or operational truth surfaces | Guards operator-facing surfaces and their read-only/runtime invariants. |
| `.agents/skills/outbox-worker/SKILL.md` | implementation | `codex-implementation` | Before changing worker, outbox, receipt, delivery-adapter, retry, or circuit-breaker behavior | Guards outbox and worker delivery invariants. |
| `.agents/skills/pick-lifecycle/SKILL.md` | implementation | `codex-implementation` | Before changing `picks.status`, `pick_lifecycle`, settlement records, distribution enqueue paths, or lifecycle transitions | Guards pick lifecycle and settlement transitions. |
| `.agents/skills/proof-closeout/SKILL.md` | verification | `codex-implementation` | When a task needs verification, proof, or closeout evidence | Runs proof and closeout workflows. |
| `.agents/skills/promotion-routing/SKILL.md` | implementation | `codex-implementation` | When changing promotion policy, scoring, target selection, routing gates, or promotion history persistence | Guards promotion policy and routing behavior. |
| `.agents/skills/repo-convergence/SKILL.md` | governance | `codex-implementation` | After parallel execution or when repo state is fragmented | Reconciles repo truth across branches, merges, and local state. |
| `.agents/skills/runtime-delivery/SKILL.md` | implementation | `codex-implementation` | When changing API enqueue, worker delivery, adapter behavior, or runtime health semantics | Guards runtime delivery behavior across the delivery path. |
| `.agents/skills/smart-form-submission/SKILL.md` | implementation | `codex-implementation` | When touching smart-form intake, fallback behavior, submission payloads, capper attribution, or smart-form promotion routing | Guards smart-form intake and submission pipeline behavior. |
| `.agents/skills/supabase-migration/SKILL.md` | verification | `codex-implementation` | When adding or changing Supabase schema, regenerating DB types, or validating DB-layer follow-up | Handles migration sequencing and validation safely. |
| `.agents/skills/system-state-loader/SKILL.md` | governance | `codex-implementation` | At session start, after reset, or when repo/queue/runtime truth may have drifted | Loads current repo state before execution. |
| `.agents/skills/web-design-guidelines/SKILL.md` | review | `codex-implementation` | When asked to review UI, accessibility, design, or UX compliance | Reviews UI code against Web Interface Guidelines. |

## 3. Target Registry Namespace: .execution/skills

The proposed target namespace for cross-agent reusable workflows is `.execution/skills/`. Entries promoted into this namespace must declare a standard metadata envelope so workflows can be shared across Codex, Claude governance, QA, and PM lanes without creating a second source of truth.

Required metadata schema for each skill entry:

- `name`: string
- `trigger`: enum (`manual` | `event` | `scheduled` | `pr-hook`)
- `owner`: string (agent name or role from `docs/05_operations/agent-role-contracts.md`)
- `category`: enum (`implementation` | `governance` | `review` | `verification` | `documentation`)
- `inputs`: list of required input parameters
- `outputs`: list of output artifacts
- `canonical_ref`: link to authoritative doc or schema

Example YAML entry:

```yaml
name: review-pr-proof
trigger: pr-hook
owner: claude-orchestrator
category: review
inputs: [pr_number, merge_sha]
outputs: [executor-result comment, proof validation status]
canonical_ref: docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md
```

## 4. Candidate Reusable Workflows

| Workflow Name | Owner | Trigger | Category | Inputs | Outputs |
|---|---|---|---|---|---|
| `review-pr-proof` | `codex-return-reviewer` | `pr-hook` | review | `pr_number`, `tier`, `verify_output`, `r_level_output` | `APPROVE/REJECT verdict`, `review findings` |
| `triage-ci-failure` | `claude-governance` | `event` | verification | `workflow_run`, `job_name`, `commit_sha` | `failure triage report`, `recommended next action` |
| `validate-migration-lane` | `db-proof-reviewer` | `pr-hook` | verification | `pr_number`, `merge_sha`, `pnpm_test_db_output` | `VALID/INVALID verdict`, `proof completeness report` |
| `audit-runtime-truth` | `lane-reconciler` | `scheduled` | governance | `lane_state`, `linear_state`, `github_state` | `reconciliation report`, `drift findings` |
| `prepare-codex-issue` | `codex-dispatch-preparer` | `manual` | governance | `linear_issue_id`, `acceptance_criteria`, `allowed_files` | `READY/NOT_READY dispatch packet`, `blocker list` |
| `closeout-linear-issue` | `claude-governance` | `event` | documentation | `issue_id`, `pr_number`, `merge_sha` | `closeout note`, `issue state transition` |

## 5. Migration and Compatibility Strategy

- `.agents/skills/` remains authoritative until a full migration is completed and ratified.
- `.execution/skills/` is the proposed target namespace for cross-agent use.
- Skills listed in `.agents/skills/` are inventoried here as-is; no files are moved or modified.
- When a skill is promoted to `.execution/skills/`, it must include the metadata schema from Section 3.
- Do NOT create `.claude/skills/` as a second canonical source.
- Migration requires: (a) PM approval, (b) cross-agent compatibility test, (c) lane manifest update.
- Skill contracts must reference canonical lane/execution truth from UTV2-962 (`docs/05_operations/EXECUTION_TRUTH_MODEL.md`).

## 6. Ownership Distinction

| Workflow Type | Primary Executor | Review Authority |
|---|---|---|
| Implementation workflows | `codex-implementation` | Claude Orchestrator, QA Agent, PM |
| Governance/review workflows | Claude Orchestrator, QA Agent, PM | PM |

## 7. Authority and Change Policy

- This document is authoritative for the skill registry.
- Changes require a T2+ lane with PM review.
- No skill may be added to `.execution/skills/` without an entry in this registry.
