# Linear Setup

## Purpose

Linear is the delivery planning system for Unit Talk V2. It owns execution planning, issue state, milestone tracking, and delivery sequencing. It does not replace documentation in Notion or contracts in the repo.

## Current Note

This file is the baseline target design for the workspace.

For the current partial-build state and the remaining UI-only completion work, also use:
- `docs/05_operations/linear_finish_pack.md`

Use both files together:
- `linear_setup.md` = intended structure and operating model
- `linear_finish_pack.md` = current reality, remaining gaps, and the exact finish work to perform

## Team Design

### Recommended Team

- Team or space name: `unit-talk-v2`
- Team key: `UTV2`
- Team description: greenfield rebuild of Unit Talk with explicit contracts, clean infrastructure, and staged migration from the legacy platform

### Ownership Model

- Product and ops owner: final scope and cutover authority
- Technical owner: contract and implementation authority
- Delivery agents: implementation, review, proof, and governance support

## Project Portfolio

### Project 1

- Name: `UTV2-R1 Foundation`
- Goal: create the clean repo, workspace tooling, CI, environment strategy, and baseline operational controls
- Exit condition: repo, CI, env management, and bootstrap documentation are stable enough to support contract-first implementation

### Project 2

- Name: `UTV2-R2 Contracts`
- Goal: ratify the domain, authority, lifecycle, distribution, settlement, and run-audit contracts
- Exit condition: all foundation contracts exist, are linked, and are accepted as implementation authority

### Project 3

- Name: `UTV2-R3 Core Pipeline`
- Goal: stand up canonical schema, submission flow, API write path, and lifecycle skeleton
- Exit condition: a submission can become a canonical pick through the approved path

### Project 4

- Name: `UTV2-R4 Distribution`
- Goal: build outbox-driven posting and receipt capture for downstream channels
- Exit condition: a canonical pick can be posted and receive durable receipts end to end

### Project 5

- Name: `UTV2-R5 Settlement`
- Goal: implement grading, settlement records, correction handling, and auditability
- Exit condition: picks can be settled without mutating immutable history

### Project 6

- Name: `UTV2-R6 Operator Control`
- Goal: create the operator read model, health visibility, and controlled override tooling
- Exit condition: operators can observe and intervene through approved authority boundaries

### Project 7

- Name: `UTV2-R7 Migration`
- Goal: map legacy surfaces, port approved logic, validate parity, and stage cutover
- Exit condition: migration ledger is complete and shadow validation is acceptable

### Project 8

- Name: `UTV2-R8 Hardening`
- Goal: address security, resilience, incident handling, and production readiness
- Exit condition: pre-cutover risks are reduced to an acceptable level with rollback and observability in place

## Milestones

- `UTV2-M1 Ratified Contracts`
  Exit criteria: all core architecture and authority contracts exist and are linked from the active roadmap
- `UTV2-M2 Canonical Schema Live`
  Exit criteria: canonical tables, migrations, and type generation path exist for V2
- `UTV2-M3 Submission Path Live`
  Exit criteria: intake to canonical pick path functions end to end in local or staging
- `UTV2-M4 Lifecycle Enforced`
  Exit criteria: lifecycle transition authority and guards are implemented and tested
- `UTV2-M5 Discord Post End-to-End`
  Exit criteria: distribution outbox, posting flow, and receipt capture work together
- `UTV2-M6 Settlement End-to-End`
  Exit criteria: settlement flow creates authoritative records with audit support
- `UTV2-M7 Operator Control v1`
  Exit criteria: read model, health visibility, and approved interventions are available
- `UTV2-M8 Cutover Ready`
  Exit criteria: migration ledger, rollback, and readiness evidence are complete

## Labels

### Delivery Labels

- `contract`
- `schema`
- `api`
- `worker`
- `frontend`
- `operator-web`
- `discord`
- `settlement`
- `migration`
- `observability`
- `docs`
- `testing`
- `security`
- `infra`
- `data`
- `tooling`

### Priority And Risk Labels

- `p0`
- `p1`
- `p2`
- `p3`
- `blocked`
- `decision-needed`
- `cutover-risk`
- `truth-drift`
- `external-dependency`

### Work Type Labels

- `build`
- `refactor`
- `delete`
- `investigation`
- `adr`
- `spike`
- `bug`
- `chore`

### Ownership Labels

- `codex`
- `claude`
- `chatgpt`
- `claude-os`

## Workflow Design

### Recommended States

- `Backlog`
- `Ready`
- `In Progress`
- `In Review`
- `Blocked`
- `Done`

### Usage Rules

- `Backlog`: issue is accepted but not ready to begin
- `Ready`: issue has enough context, contract linkage, and acceptance criteria to start
- `In Progress`: active implementation or investigation is underway
- `In Review`: implementation complete and waiting on validation or review
- `Blocked`: external dependency or decision prevents progress
- `Done`: acceptance criteria and required proof are complete

## Issue Design Standard

### Required Fields In Every Issue Body

- Problem
- Why now
- Source of truth or contract
- Scope in
- Scope out
- Acceptance criteria
- Risks
- Test proof required
- Migration impact
- Dependencies
- Owner
- Agent lane

### Required Linking Rules

- Every implementation issue must link to a repo doc or contract.
- Every PR must link back to a Linear issue.
- Every milestone issue must link to the relevant closeout or evidence artifacts.

## Initial Issue Pack

### Foundation

- `UTV2-FOUND-01` Create repo bootstrap, workspace tooling, and package boundaries
- `UTV2-FOUND-02` Add CI skeleton for install, type-check, and build
- `UTV2-FOUND-03` Define environment variable ownership and local env templates
- `UTV2-FOUND-04` Establish docs hierarchy and decision logging rules

### Contracts

- `UTV2-CONTRACT-01` Ratify submission contract
- `UTV2-CONTRACT-02` Ratify writer authority contract
- `UTV2-CONTRACT-03` Ratify pick lifecycle contract
- `UTV2-CONTRACT-04` Ratify distribution contract
- `UTV2-CONTRACT-05` Ratify settlement contract
- `UTV2-CONTRACT-06` Ratify run and audit contract
- `UTV2-CONTRACT-07` Ratify environment contract

### Core Pipeline

- `UTV2-PIPE-01` Design canonical V2 schema
- `UTV2-PIPE-02` Implement submission intake path
- `UTV2-PIPE-03` Implement canonical pick creation path
- `UTV2-PIPE-04` Implement lifecycle transition skeleton

### Distribution

- `UTV2-DIST-01` Design distribution outbox schema and event contract
- `UTV2-DIST-02` Implement Discord posting worker path
- `UTV2-DIST-03` Implement receipt capture and retry handling

### Settlement

- `UTV2-SET-01` Design settlement record model
- `UTV2-SET-02` Implement grading and correction path

### Operator Control

- `UTV2-OPS-01` Define operator read model
- `UTV2-OPS-02` Implement service health and run visibility

### Migration

- `UTV2-MIG-01` Create migration ledger from legacy repo
- `UTV2-MIG-02` Identify reusable lifecycle logic
- `UTV2-MIG-03` Stage shadow validation plan

### Hardening

- `UTV2-HARD-01` Define incident and rollback plan
- `UTV2-HARD-02` Add hardening backlog for cutover-risk items

## Cycle Policy

- Use weekly cycles for execution once the first real implementation issue is ready.
- Keep contract ratification work out of a cycle if it is still exploratory.
- Move issues into a cycle only when they are truly `Ready`.

## Priority Policy

- `p0`: blocks progress or threatens data integrity
- `p1`: critical path for the current milestone
- `p2`: important but not blocking the active milestone
- `p3`: valuable cleanup, follow-up, or deferred hardening

## Rules

- No implementation work starts without a linked issue and a referenced contract or decision doc.
- No issue moves to `Done` without the required proof or validation.
- Slack decisions that affect scope must be mirrored into Linear and Notion.
- If milestone order changes, update the roadmap docs before changing delivery sequencing in Linear.

## Setup Checklist

1. Create or confirm the `unit-talk-v2` team.
2. Create the eight rebuild projects in the order listed above.
3. Create the milestone set `UTV2-M1` through `UTV2-M8`.
4. Create the delivery, risk, work-type, and ownership labels.
5. Add the initial issue pack and map each issue to a project.
6. Set weekly cycles only after the first `Ready` implementation issues exist.
7. Link the team workspace to the repo docs and Notion rebuild home.

## Finish Rule

The workspace is not considered fully operational until all of the following are true:
- project and milestone states match the repo authority docs
- active issues match the real current work rather than the original seed backlog
- saved views exist for active execution, closeout, migration, and hardening oversight
- project pulse / status updates exist for the active projects
- repo and Notion control links are attached in Linear
- Git integration is verified against the real repo and real commit history
