# Agent Tooling Classification

> **Status:** Active authority.
> **Created:** 2026-05-18.
> **Authority tier:** Tier 4 - Operating Policy.
> **Owner:** Program Owner.

## Purpose

Unit Talk has prompt agents, scripts, workflows, and skills. These are not the same thing.

This document classifies each agent/tooling surface by operational authority so the team can tell which systems are real gates, which systems are monitors, which systems are manual accelerators, and which systems should be collapsed or removed.

## Operating Rule

Every operational agent or tool must be classified as exactly one of:

| Category | Meaning | Creates A Guarantee? |
| --- | --- | --- |
| Required gate | Runs automatically in CI, deploy, or merge flow and can block progress | Yes |
| Scheduled monitor | Runs automatically on a schedule and produces an artifact, issue, alert, or state mutation | Partial |
| Manual tool | Useful only when an operator invokes it | No |
| Archive/delete candidate | Duplicates stronger machinery or creates false confidence | No |

Prompt-agent existence is not enforcement. A `.claude/agents/*.md` file only proves the prompt exists and passes contract validation. It does not prove the agent runs, blocks merges, updates Linear, or validates runtime truth.

No recurring-purpose tool may remain manual as its final state. If a manual tool serves a repeated operational purpose, it must be promoted to an automatic gate or scheduled monitor. If it cannot be promoted, it must be explicitly marked as a diagnostic or retired.

## Current Classification

| Surface | Type | Category | Current wiring | Expected use | Gap |
| --- | --- | --- | --- | --- | --- |
| `runtime-verifier` | Claude prompt agent | Manual tool, transitional | `.claude/agents/runtime-verifier.md` validates; `.github/workflows/runtime-verifier-gate.yml` runs `scripts/ops/runtime-verifier-gate.ts` only for PRs touching `docs/06_status/proof/**` | Transitional human review aid until UTV2-1045 expands workflow coverage | The prompt agent is not auto-triggered. The workflow skips PRs without proof-path changes and is not proof of general runtime readiness. |
| `proof-auditor` | Claude prompt agent | Manual tool, transitional | `.claude/agents/proof-auditor.md` validates; `pnpm ops:proof-auditor-gate` exists | Transitional human review aid until UTV2-1046 makes the script a required CI gate | No workflow was found that auto-runs this script as a required status. |
| `lane-reconciler` | Claude prompt agent | Scheduled monitor | Prompt validates; `.github/workflows/ops-reconcile.yml` runs `pnpm ops:reconcile -- --apply --json` daily and on manual dispatch | Detect and mutate stranded lane manifests | The scheduled script is real; the prompt agent is not the scheduled actor. |
| `codex-return-reviewer` | Claude prompt agent | Manual tool, transitional | Prompt validates; can consume `scripts/ops/pr-review-packet.ts` output | Transitional review aid until UTV2-1047 automates PR packet generation/checking for T1/T2 PRs | Not automatically invoked on PR open/update and not a required check. |
| `pr-risk-reviewer` | Claude prompt agent | Manual tool, transitional | Prompt validates; can consume `scripts/ops/pr-review-packet.ts` output | Transitional review aid until UTV2-1047 automates deterministic risk scoring for T1/T2 PRs | Not automatically invoked and does not block merge. |
| `ci-triage` | Claude prompt agent | Manual diagnostic | Prompt validates only | Diagnose failed GitHub Actions runs after a red check exists; UTV2-1050 tracks automatic CI failure triage into Linear | Reactive only. Does not auto-watch CI failures or open fixes today. Diagnostic status is acceptable only if no automatic remediation claim is made. |
| `lane-governor` | Claude prompt agent | Manual tool, transitional | Prompt validates; dispatch flow contains separate concurrency logic | Transitional dispatch aid until UTV2-1048 produces automatic dispatch preflight artifacts | The prompt is not the source of enforcement. Dispatch/manifest policy is the real layer. |
| `db-proof-reviewer` | Claude prompt agent | Archive/delete candidate | Prompt validates; overlaps proof-auditor and live-DB proof checks | UTV2-1049 retires, archives, or explicitly downgrades it after UTV2-1046 coverage exists | Redundant with proof-auditor intent and DB proof CI/script expectations. Keep only if renamed advisory; otherwise remove. |
| `scripts/ops/runtime-verifier-gate.ts` | Script | Required gate, limited scope | Auto-runs through `runtime-verifier-gate.yml` on proof-path PRs | Validate proof bundle SHA/runtime evidence when proof changes | Limited trigger scope. Does not run on every runtime PR. |
| `scripts/ops/proof-auditor-gate.ts` | Script | Manual tool | Exposed as `pnpm ops:proof-auditor-gate` | Validate proof bundle shape and placeholders | Must be wired to CI before it can be called a gate. |
| `scripts/ops/reconcile.ts` | Script | Scheduled monitor | Auto-runs daily through `ops-reconcile.yml` | Detect stale/stranded/orphaned lane manifests and apply allowed mutations | Real scheduled monitor. Confirm pushed mutations are visible despite branch protection. |
| `scripts/ops/pr-review-packet.ts` | Script | Manual tool | Consumed by prompt agents when invoked | Produce deterministic PR review packet | Should be promoted to CI artifact if PR review is expected before merge. |
| `scripts/ops/agent-scoreboard.ts` | Script | Manual tool | Exposed as `pnpm ops:agent-scoreboard` | Summarize agent/lane outcomes | Not a guarantee unless scheduled and acted on. |
| `.agents/skills/**` | Codex skills | Manual tool | Loaded by Codex when trigger rules match | Guard implementation behavior inside Codex sessions | Skills guide the active assistant; they do not run outside the session. |
| `apps/qa-agent` and QA workflows | App/workflow | Required gate or scheduled monitor depending on workflow | `qa-fast.yml` and `qa-experience-regression.yml` exist | Validate UI/API experience regressions | Separate from `.claude/agents`; do not count as governance prompt agents. |

## Required Gate Standard

A tool may be called a required gate only if all conditions are true:

1. It runs automatically in the relevant PR, merge, deploy, or runtime-readiness flow.
2. It exits non-zero or reports failure in a way that blocks progress.
3. Its status is listed as a required check where branch protection or deployment policy expects it.
4. It writes or uploads an artifact that can be audited after the run.
5. Its trigger covers the class of changes it claims to protect.

If any condition is false, classify the tool as a manual tool or scheduled monitor.

## Scheduled Monitor Standard

A tool may be called a scheduled monitor only if all conditions are true:

1. It runs on `schedule`, durable service cadence, or equivalent external automation.
2. It has enough credentials to read the canonical source of truth it claims to monitor.
3. It emits an artifact, alert, issue update, or state mutation.
4. Failure is visible to the operator.

If failure is silent, the monitor is not operationally trusted.

## Manual Tool Standard

Manual tools are allowed only as diagnostics, one-shot migration aids, or explicitly transitional wiring gaps. They cannot be used as proof that the platform enforces a guarantee.

Manual tools must be described as one of:

- `operator accelerator`: saves human review time.
- `review aid`: improves judgment but does not block.
- `diagnostic`: helps investigate a known failure.
- `one-shot migration aid`: used during a specific lane and then retired.
- `transitional wiring gap`: useful now, but must be promoted to automatic trigger or retired.

## Archive/Delete Standard

Archive or delete a tool when any of these are true:

1. A stronger CI/script gate already enforces the same guarantee.
2. It is prompt-only but documented as if it blocks progress.
3. It returns advisory output that operators routinely ignore.
4. It creates a green status without blocking on failure.
5. It has no owner, trigger, or recent operational use.

## Immediate Convergence Actions

| Action | Target | Reason |
| --- | --- | --- |
| Rename any docs that call prompt agents "gates" unless a workflow enforces them | Agent docs and proof docs | Prevent false confidence |
| Promote `proof-auditor-gate.ts` to CI if proof completeness is expected before merge | `proof-auditor` | Current script is not a gate |
| Expand or explicitly scope `runtime-verifier-gate.yml` | `runtime-verifier` | Current trigger only covers proof-path changes |
| Keep `ops-reconcile.yml` as the canonical scheduled lane monitor | `lane-reconciler` | This is the real automated lane-drift actor |
| Retire or rename `db-proof-reviewer` | `db-proof-reviewer` | Redundant unless preserved as advisory review aid |
| Produce PR review packets automatically for T1/T2 PRs if PM expects mandatory review | `codex-return-reviewer`, `pr-risk-reviewer` | Current review is manual |
| Add an automation coverage check that fails when a recurring-purpose tool is classified as manual without a promotion/retirement target | All agent/tooling surfaces | Prevent manual babysitting from becoming permanent |

## Tracking Issues

| Issue | Purpose |
| --- | --- |
| UTV2-1044 | Automation convergence gate for all recurring-purpose tools |
| UTV2-1045 | Expand runtime-verifier trigger coverage |
| UTV2-1046 | Promote proof-auditor to required CI proof gate |
| UTV2-1047 | Auto-generate PR review and risk packets |
| UTV2-1048 | Promote lane-governor checks into dispatch preflight artifact |
| UTV2-1049 | Retire or collapse db-proof-reviewer |
| UTV2-1050 | Automate CI failure triage into Linear |

## Verdict

The current agent layer is valid but not autonomous. The reliable operational guarantees come from scripts and workflows that are actually wired into CI or schedules. Prompt agents are useful operator tools, but they are not enforcement until their logic is encoded as required gates or scheduled monitors.
