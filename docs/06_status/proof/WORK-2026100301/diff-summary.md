# Diff summary: WORK-2026100301

PR: https://github.com/griff843/Unit-Talk-v2/pull/1714

PM-reviewed product SHA: ca2ef310e6726a088f1a12e0d82d0e924ad8e2f7. Product-path diff (`apps/**`, `packages/**`) during control closure: empty. Exact closure HEAD is returned in the PM handoff and bound by CI. Merge SHA: pending merge.

This inventory includes implementation, contract reconciliation, admission metadata and measured evidence. See review-packet.md for behavior changes and verification.md for gates.

| File | Purpose |
|---|---|
| [.github/workflows/shadow-parity-required.yml](../../../../.github/workflows/shadow-parity-required.yml) | Exact-base shadow runtime/install and candidate/base identity evidence |
| [scripts/ci/assert-unmodified-vs-base.test.ts](../../../../scripts/ci/assert-unmodified-vs-base.test.ts) | General shadow execution-control regression coverage |
| [docs/06_status/proof/WORK-2026100301/verify-tail.log](../../../../docs/06_status/proof/WORK-2026100301/verify-tail.log) | Final verification output and staging refusal |
| [.ops/sync/WORK-2026100301.yml](../../../../.ops/sync/WORK-2026100301.yml) | Work order and lane admission metadata |
| [.ops/work/WORK-2026100301.md](../../../../.ops/work/WORK-2026100301.md) | Work order and lane admission metadata |
| [apps/api/src/alert-notification-service.test.ts](../../../../apps/api/src/alert-notification-service.test.ts) | Deterministic regression coverage |
| [apps/api/src/grading-cron.ts](../../../../apps/api/src/grading-cron.ts) | Shared presentation or existing sender migration |
| [apps/api/src/grading-service.test.ts](../../../../apps/api/src/grading-service.test.ts) | Deterministic regression coverage |
| [apps/api/src/grading-service.ts](../../../../apps/api/src/grading-service.ts) | Shared presentation or existing sender migration |
| [apps/api/src/hedge-notification-service.test.ts](../../../../apps/api/src/hedge-notification-service.test.ts) | Deterministic regression coverage |
| [apps/api/src/recap-service.test.ts](../../../../apps/api/src/recap-service.test.ts) | Deterministic regression coverage |
| [apps/api/src/recap-service.ts](../../../../apps/api/src/recap-service.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/alerts-setup.ts](../../../../apps/discord-bot/src/commands/alerts-setup.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/heat-signal.ts](../../../../apps/discord-bot/src/commands/heat-signal.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/help.ts](../../../../apps/discord-bot/src/commands/help.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/leaderboard.ts](../../../../apps/discord-bot/src/commands/leaderboard.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/live.ts](../../../../apps/discord-bot/src/commands/live.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/my-picks.ts](../../../../apps/discord-bot/src/commands/my-picks.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/ops-restart.ts](../../../../apps/discord-bot/src/commands/ops-restart.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/pick.ts](../../../../apps/discord-bot/src/commands/pick.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/recap.ts](../../../../apps/discord-bot/src/commands/recap.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/results.ts](../../../../apps/discord-bot/src/commands/results.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/stats.ts](../../../../apps/discord-bot/src/commands/stats.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/today.ts](../../../../apps/discord-bot/src/commands/today.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/trial-status.ts](../../../../apps/discord-bot/src/commands/trial-status.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/commands/upgrade.ts](../../../../apps/discord-bot/src/commands/upgrade.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/discord-bot-foundation.test.ts](../../../../apps/discord-bot/src/discord-bot-foundation.test.ts) | Deterministic regression coverage |
| [apps/discord-bot/src/discord-design-system.test.ts](../../../../apps/discord-bot/src/discord-design-system.test.ts) | Deterministic regression coverage |
| [apps/discord-bot/src/embeds/intelligence-display.ts](../../../../apps/discord-bot/src/embeds/intelligence-display.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/embeds/presentation.ts](../../../../apps/discord-bot/src/embeds/presentation.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/handlers/capper-onboarding-handler.ts](../../../../apps/discord-bot/src/handlers/capper-onboarding-handler.ts) | Shared presentation or existing sender migration |
| [apps/discord-bot/src/router.ts](../../../../apps/discord-bot/src/router.ts) | Shared presentation or existing sender migration |
| [apps/ingestor/package.json](../../../../apps/ingestor/package.json) | Existing dependency/test verification wiring |
| [apps/ingestor/src/index.ts](../../../../apps/ingestor/src/index.ts) | Shared presentation or existing sender migration |
| [apps/worker/src/delivery-adapters.ts](../../../../apps/worker/src/delivery-adapters.ts) | Shared presentation or existing sender migration |
| [apps/worker/src/official-picks-embed.test.ts](../../../../apps/worker/src/official-picks-embed.test.ts) | Deterministic regression coverage |
| [apps/worker/src/worker-runtime.test.ts](../../../../apps/worker/src/worker-runtime.test.ts) | Deterministic regression coverage |
| [artifacts/r2-determinism-WORK-2026100301.json](../../../../artifacts/r2-determinism-WORK-2026100301.json) | Measured evidence and review packet |
| [artifacts/r4-fault-report-WORK-2026100301.json](../../../../artifacts/r4-fault-report-WORK-2026100301.json) | Measured evidence and review packet |
| [artifacts/shadow-report-WORK-2026100301.json](../../../../artifacts/shadow-report-WORK-2026100301.json) | Measured evidence and review packet |
| [docs/06_status/lanes/WORK-2026100301.json](../../../../docs/06_status/lanes/WORK-2026100301.json) | Work order and lane admission metadata |
| [docs/06_status/proof/WORK-2026100301/diff-summary.md](../../../../docs/06_status/proof/WORK-2026100301/diff-summary.md) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/evidence.json](../../../../docs/06_status/proof/WORK-2026100301/evidence.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/model-routing.json](../../../../docs/06_status/proof/WORK-2026100301/model-routing.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/presentation-proof.ts](../../../../docs/06_status/proof/WORK-2026100301/presentation-proof.ts) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/r2-determinism-WORK-2026100301.json](../../../../docs/06_status/proof/WORK-2026100301/r2-determinism-WORK-2026100301.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/r4-fault-report-WORK-2026100301.json](../../../../docs/06_status/proof/WORK-2026100301/r4-fault-report-WORK-2026100301.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-desktop-detail.png](../../../../docs/06_status/proof/WORK-2026100301/render-desktop-detail.png) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-desktop.png](../../../../docs/06_status/proof/WORK-2026100301/render-desktop.png) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-fixtures.json](../../../../docs/06_status/proof/WORK-2026100301/render-fixtures.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-mobile-detail.png](../../../../docs/06_status/proof/WORK-2026100301/render-mobile-detail.png) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-mobile.png](../../../../docs/06_status/proof/WORK-2026100301/render-mobile.png) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-preview.html](../../../../docs/06_status/proof/WORK-2026100301/render-preview.html) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/render-report.json](../../../../docs/06_status/proof/WORK-2026100301/render-report.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/review-packet.md](../../../../docs/06_status/proof/WORK-2026100301/review-packet.md) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/scope-extension.md](../../../../docs/06_status/proof/WORK-2026100301/scope-extension.md) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/shadow-report-WORK-2026100301.json](../../../../docs/06_status/proof/WORK-2026100301/shadow-report-WORK-2026100301.json) | Measured evidence and review packet |
| [docs/06_status/proof/WORK-2026100301/verification.md](../../../../docs/06_status/proof/WORK-2026100301/verification.md) | Measured evidence and review packet |
| [docs/discord/DISCORD_EMBED_CONTRACT.md](../../../../docs/discord/DISCORD_EMBED_CONTRACT.md) | Active presentation contract reconciliation |
| [docs/discord/discord_embed_system_spec_addendum_assets.md](../../../../docs/discord/discord_embed_system_spec_addendum_assets.md) | Active presentation contract reconciliation |
| [docs/discord/discord_embed_system_spec.md](../../../../docs/discord/discord_embed_system_spec.md) | Active presentation contract reconciliation |
| [docs/discord/discord_message_contract_matrix.md](../../../../docs/discord/discord_message_contract_matrix.md) | Active presentation contract reconciliation |
| [package.json](../../../../package.json) | Existing dependency/test verification wiring |
| [packages/alert-runtime/src/alert-notification-service.ts](../../../../packages/alert-runtime/src/alert-notification-service.ts) | Shared presentation or existing sender migration |
| [packages/alert-runtime/src/hedge-notification-service.ts](../../../../packages/alert-runtime/src/hedge-notification-service.ts) | Shared presentation or existing sender migration |
| [packages/alert-runtime/src/injury-notification-service.test.ts](../../../../packages/alert-runtime/src/injury-notification-service.test.ts) | Deterministic regression coverage |
| [packages/alert-runtime/src/injury-notification-service.ts](../../../../packages/alert-runtime/src/injury-notification-service.ts) | Shared presentation or existing sender migration |
| [packages/domain/src/discord-presentation.ts](../../../../packages/domain/src/discord-presentation.ts) | Shared presentation or existing sender migration |
| [packages/domain/src/index.ts](../../../../packages/domain/src/index.ts) | Shared presentation or existing sender migration |
| [packages/domain/src/recap-embed.ts](../../../../packages/domain/src/recap-embed.ts) | Shared presentation or existing sender migration |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | Existing dependency/test verification wiring |
| [scripts/backup-alert-check.ts](../../../../scripts/backup-alert-check.ts) | Shared presentation or existing sender migration |
| [scripts/grading-alert-check.ts](../../../../scripts/grading-alert-check.ts) | Shared presentation or existing sender migration |
| [scripts/ingestor-alert-check.ts](../../../../scripts/ingestor-alert-check.ts) | Shared presentation or existing sender migration |
| [scripts/ops/daily-digest.ts](../../../../scripts/ops/daily-digest.ts) | Shared presentation or existing sender migration |
| [scripts/ops/stale-lane-alerter.ts](../../../../scripts/ops/stale-lane-alerter.ts) | Shared presentation or existing sender migration |
| [scripts/worker-alert-check.ts](../../../../scripts/worker-alert-check.ts) | Shared presentation or existing sender migration |
