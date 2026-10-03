# WORK-2026100301 - Discord Automated Message Design System

Tier: T1
Lane type: runtime
Executor: codex-cli

## Objective

Implement Griff's 2026-10-03 Discord Automated Message Design System against current
origin/main. Unify automated message presentation in gold (#C7A34B), white, and black
while preserving canonical data truth and every existing product/runtime policy.

## Acceptance Criteria

- Add shared presentation tokens, helpers and builders within an existing package.
- Migrate all existing automated Discord messages, including worker delivery,
  settlement results, recaps, stats, leaderboard, trial status, upgrade, onboarding,
  access denied, and errors. Preserve semantic colors only for settled outcomes.
- Remove public confidence and High/Medium/Low labels even when source data contains it.
- Never invent metrics, identity, prices, sportsbook or timestamps. Omit unknown CLV;
  render measured zero. Optional missing fields/media disappear without blocking delivery.
- Equal win/loss detail; recap chunking retains every supplied settled loss.
- Implement all requested launch-family builders. Do not wire absent lifecycle triggers.
- No invented VIP+ price or purchasable Black Label offer; private denial/error responses.
- Reconcile DISCORD_EMBED_CONTRACT.md and related active Discord design specs.
- Add deterministic node:test/tsx tests for all explicit truth/size/privacy requirements.
- Run focused tests throughout; finish with pnpm verify and applicable R-level proof.
- Inspect representative desktop/mobile rendering; use sandbox proof where available,
  disclose absent sandbox credentials rather than claim real Discord proof.
- Return PR, exact HEAD, files/families, truth fixes, verification, rendering evidence,
  remaining routing/product gaps and intentionally unwired families for PM review.

## File Scope

- packages/domain/src/discord-presentation.ts
- packages/domain/src/discord-presentation.test.ts
- packages/domain/src/recap-embed.ts
- packages/domain/src/index.ts
- packages/domain/src/domain.test.ts
- apps/worker/src/**
- apps/discord-bot/src/**
- apps/api/src/recap-service.ts
- apps/api/src/recap-service.test.ts
- docs/discord/**
- .ops/work/WORK-2026100301.md
- Named lane/proof metadata and R-level artifacts for WORK-2026100301

## Guardrails

Do not change entitlements, prices, permissions, routing/promotion, scoring, grading,
settlement, providers, kill switches, Black Label activation, topology, or capper identity.
Do not activate blocked targets. Do not create a new package or runtime trigger.
Do not modify mission intent or plan. Report all-tier settled-result routing gaps
separately. Stop for overlapping live file ownership or policy disagreements requiring
an actual access/routing change. Canonical membership wins over stale presentation copy.

## Execution Approval

Griff explicitly assigned this bounded system on 2026-10-03, including worker pick
presentation and canonical embed-document reconciliation. Griff delegated the work-ID
choice with "whatever you recommend"; WORK-2026100301 is the selected identity.
This permits bounded presentation edits in the named Tier C domain/worker surfaces;
it does not permit grading, lifecycle, route, entitlement or activation changes.
Return the resulting packet for PM review; no merge/deployment approval is implied.

## Approved scope extension

Griff approved "Include all existing senders (Recommended)" on 2026-10-03 after the
sender audit identified notification builders and operations webhooks outside the
initial file lock. Add the following presentation-only surfaces to this same work
packet. Preserve activation, routing, provider behavior, detection, cooldowns and
grading authority. The existing domain package dependency may be added to ingestor
solely to consume the same pure presentation builder; no new package is created.

- packages/alert-runtime/src/alert-notification-service.ts
- packages/alert-runtime/src/hedge-notification-service.ts
- packages/alert-runtime/src/injury-notification-service.ts
- packages/alert-runtime/src/injury-notification-service.test.ts
- apps/api/src/alert-notification-service.test.ts
- apps/api/src/hedge-notification-service.test.ts
- apps/api/src/grading-cron.ts
- apps/api/src/grading-cron.test.ts
- apps/ingestor/src/index.ts
- apps/ingestor/package.json
- pnpm-lock.yaml

The same "all existing senders" approval includes existing scheduled monitor/digest
Discord posts. These exact paths receive the shared Service Alert builder only:

- scripts/grading-alert-check.ts
- scripts/ingestor-alert-check.ts
- scripts/worker-alert-check.ts
- scripts/backup-alert-check.ts
- scripts/ops/daily-digest.ts
- scripts/ops/stale-lane-alerter.ts

Required measured R-level reports are committed at these exact paths so CI can
inspect the same evidence despite the default artifacts ignore rule:

- artifacts/r2-determinism-WORK-2026100301.json
- artifacts/shadow-report-WORK-2026100301.json
- artifacts/r4-fault-report-WORK-2026100301.json

The existing settled-result sender also needs its display-only capper fallback
removed. Add `apps/api/src/grading-service.ts` and its test file exclusively for
that rendering input; do not change grading, settlement, channels or stake guards.
