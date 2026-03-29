# Codex Wave Execution Playbook

## Purpose

This document defines the default operating model for executing a batch of Unit Talk V2 issues with Codex while preserving:

- review cleanliness
- Linear discipline
- low merge risk
- reliable verification

The goal is not to maximize visible parallelism. The goal is to maximize safe throughput.

## Core Principle

Prefer controlled lane execution over naive issue-by-issue parallelism.

If multiple issues touch the same runtime, bootstrap, middleware, repository, or test surfaces, they should be treated as one implementation lane even if they remain separate Linear issues.

## Wave Intake

Before starting a wave, classify each issue into exactly one of these buckets:

### Foundation

Shared primitives or contracts that other issues should build on.

Examples:

- observability helpers
- shared config/env parsing
- common runtime contracts
- package-level utilities

### Lane Work

Overlapping issues inside the same product surface.

Examples:

- multiple `apps/api` runtime hardening tasks
- multiple `apps/worker` lifecycle and watchdog tasks

### Independent Surface Work

Tasks with clearly disjoint write scopes that can be implemented and reviewed independently.

Examples:

- `apps/operator-web`
- `apps/discord-bot`
- isolated root script or CI work

## Parallelism Rules

Use true parallel implementation only when all of the following are true:

- the write scopes are disjoint
- no shared contract is still being defined
- the work can be reviewed independently

Good candidates for parallel execution:

- isolated app surfaces
- CI or manifest tooling
- proof or verification work that does not change runtime logic

Bad candidates for parallel execution:

- multiple API runtime issues touching the same server bootstrap
- multiple worker runtime issues touching the same claim/delivery loop
- anything that depends on unfinished foundation work

## Lane Ownership

Assign one owner per lane.

That owner is responsible for:

- implementation integrity across the lane
- local verification for the lane
- commit packaging for the lane
- clean handoff into review

Multiple issues may map to one lane. They do not need separate implementation threads if the code overlap is heavy.

## Branch Strategy

Default to stacked branches when later slices depend on earlier slices.

Recommended pattern:

1. foundation branch from `main`
2. next lane branch from foundation branch
3. next lane branch from previous lane branch

Use separate `main`-based branches only when the work is fully independent and can merge in any order.

## Commit Strategy

Commit by review slice, not by micro-change.

Good review slices:

- foundation slice
- API lane slice
- worker lane slice
- independent surface slice

Avoid mixing unrelated fixes into the same commit. If a shared file must be touched by multiple slices, keep only the changes that belong to the current slice staged at commit time.

## Linear Discipline

Each issue remains the source of truth even when multiple issues share one PR.

For every issue in the wave:

- keep the issue status unchanged until implementation and verification are real
- move to `In Review` only after branch and PR exist
- attach the PR link
- leave a short execution note with:
  - branch name
  - PR link
  - what landed
  - verification commands run

If one PR covers multiple issues, say so explicitly on every issue.

## Verification Rules

Verification happens at two levels.

### Slice-Level Verification

Run the smallest meaningful verification set before each commit.

Examples:

- package tests
- app-specific type-check
- targeted runtime tests

### Stack-Level Verification

Run the full repo gate after the full stack is assembled.

Default gate:

- `pnpm verify`

This catches interactions between slices that local checks may miss.

## Crash or Tooling Recovery

If sub-agents, delegation, or tool state becomes unreliable:

- stop spawning more workers
- preserve work immediately
- re-home the changes onto clean branches from `origin/main`
- continue with one orchestrator thread
- preserve the planned lane structure even if execution becomes centralized

Reliability is more important than visible concurrency.

## Default Decision Heuristic

Use these questions to choose the operating model:

### Question 1

Can these issues merge independently without conflict?

- If yes, parallel work is acceptable.
- If no, keep them in one lane.

### Question 2

Will one issue define contracts or primitives that the others should consume?

- If yes, do that issue first as foundation.

### Question 3

Would extra parallelism create review noise or staging complexity?

- If yes, reduce concurrency and preserve clean slices.

## Default Operating Sequence

For a new wave, use this sequence:

1. classify issues into foundation, lanes, and independent surfaces
2. decide where true parallelism is safe
3. assign one owner per overlapping lane
4. implement by lane
5. package into stacked or separate branches
6. verify locally per slice
7. run full-stack `pnpm verify`
8. open PRs in review order
9. update Linear only after verification is green

## Review Order

When using stacked PRs, review must follow dependency order.

Review the lowest branch first, then move upward through the stack.

Do not flatten review comments across the whole wave. Keep comments scoped to the slice where the behavior belongs.

## Recommended Default

For Unit Talk V2, the default should be:

- parallelize research, isolated execution, and verification where safe
- keep overlapping runtime work inside a single lane owner
- prefer stacked PRs when a foundation slice feeds later work
- optimize for correctness, clean history, and reviewability over visible concurrency
