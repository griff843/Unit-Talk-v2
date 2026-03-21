# Canary Graduation Criteria

This document defines what must be true before `unit-talk-v2` can widen live routing beyond `discord:canary`.

It currently governs only the first promotion decision:
- from `discord:canary`
- to `discord:best-bets`

It does not authorize:
- `discord:game-threads`
- `discord:strategy-room`
- broad multi-channel posting
- any live target that depends on thread routing, DM routing, or access-tier logic

## Promotion Principle

Promotion is a go/no-go decision, not an automatic next step.

The burden of proof is:
- canary delivery is operationally stable
- operator visibility is good enough to detect problems quickly
- the current behavior is documented, verified, and reflected in Notion and Linear

If any criterion below is not satisfied, live routing stays canary-only.

## Required Criteria

### 1. Runtime Stability

All of the following must be true:
- `pnpm lint` passes
- `pnpm type-check` passes
- `pnpm build` passes
- `pnpm test` passes
- `pnpm test:db` passes
- no known open bug exists in:
  - submission intake
  - lifecycle transition to `posted`
  - outbox claim/sent flow
  - receipt recording
  - system run timestamps

### 2. Delivery Reliability

All of the following must be true for the canary lane:
- at least 3 recent live canary deliveries have succeeded end to end
- each verified delivery has:
  - a `distribution_outbox` row in `sent`
  - a `distribution_receipts` row
  - an `audit_log` record for enqueue and send
  - a `system_runs` record with valid `started_at` and `finished_at`
- no unexplained failed or dead-letter canary rows are present in the recent operator view

This threshold is intentionally small for V2. It proves a controlled lane, not broad rollout readiness.

### 3. Operator Readiness

All of the following must be true:
- operator-web can filter and inspect degraded or failed operational states quickly
- current operator views are sufficient to answer:
  - what failed
  - when it failed
  - which target was affected
  - whether retries or dead-letter states exist
- any known operator blind spot is explicitly recorded as a risk

### 4. Smart Form Safety

All of the following must be true:
- smart-form remains intake-only
- smart-form never writes canonical business tables directly
- browser-facing validation and confirmation behavior is present
- no unresolved issue exists where the browser surface could create false operator confidence about downstream posting

### 5. Governance And Tracking

All of the following must be true:
- the active roadmap, current phase, and system snapshot docs match runtime reality
- Notion weekly/checkpoint state reflects the current week
- Linear milestone and issue state reflects the current week
- `M3 Submission Path Live` and `M4 Lifecycle Enforced` no longer show false incompleteness due to missing issue linkage

### 6. Route Suitability

All of the following must be true for `discord:best-bets` specifically:
- the target is a plain channel post
- no thread-routing requirement exists
- no DM-routing requirement exists
- no access-tier gating requirement is missing from the implementation path

This is why `discord:best-bets` is the only candidate covered by this document right now.

## Explicit Blockers

Do not approve promotion if any of the following is true:
- live routing beyond `discord:canary` is being requested without this document being cited
- operator-web cannot clearly surface failed or dead-letter rows for the target being evaluated
- milestone tracking is materially out of sync with repo reality
- Discord delivery behavior is only proven in dry-run mode
- the promotion depends on thread routing or DM routing

## Required Evidence For The Decision

Before approving promotion, bundle the following:
- latest green verification command results
- at least one recent live canary proof set:
  - submission ID
  - pick ID
  - outbox ID
  - receipt ID
  - Discord message ID
- current operator snapshot summary
- explicit yes/no statement for each required criterion

The decision should be recorded in:
- repo docs
- Notion weekly/checkpoint state
- Linear issue or milestone comments

## Approval Outcomes

### Go

If every criterion is satisfied:
- `discord:best-bets` may be approved as the next live lane
- the approval must be explicitly recorded before config changes are made
- `discord:canary` remains active even after promotion

### No-Go

If any criterion is not satisfied:
- live routing remains canary-only
- the blocking criteria must be named directly
- the next remediation step must be recorded in Linear and Notion

## Current Status

As of 2026-03-20, the criteria have been evaluated against the live system.

| Criterion | Result | Evidence |
|-----------|--------|----------|
| 1. Runtime Stability | PASS | `pnpm lint`, `pnpm type-check`, `pnpm build`, `pnpm test`, `pnpm test:db` green |
| 2. Delivery Reliability | PASS | live operator snapshot shows `canary.recentSentCount = 3`, `recentFailureCount = 0`, `recentDeadLetterCount = 0`, `graduationReady = true` |
| 3. Operator Readiness | PASS | operator-web has DB-side filtering, incident triage, and canary-readiness evidence |
| 4. Smart Form Safety | PASS | smart-form remains intake-only with browser-facing validation and confirmation UX |
| 5. Governance and Tracking | PASS | roadmap, Notion, and Linear aligned; M3/M4 milestone tracking debt cleared |
| 6. Route Suitability | PASS | `discord:best-bets` is a plain channel target with no thread or DM dependency |

Result: **GO**

Latest live operator evidence:
- `data.canary.graduationReady = true`
- `recentSentCount = 3`
- `recentFailureCount = 0`
- `recentDeadLetterCount = 0`
- `latestMessageId = 1484472576418779178`

Follow-through after GO:
1. record the decision in Notion and Linear
2. close `UNI-129`
3. prepare the controlled routing/config update for adding `discord:best-bets`
