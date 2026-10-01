# Diff summary: UTV2-1963

Production deployment previously promoted command code without replacing the guild registry. Promotion now registers the exact promoted bot's source manifest and verifies read-back before smoke acceptance.

| File                                             | Change                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| .github/workflows/deploy.yml                     | Mandatory registration after promotion; exact release and bot-image checks; nonzero result fails promotion. |
| apps/discord-bot/scripts/deploy-commands.ts      | Existing guild full replacement plus application identity/read-back verification and safe error handling.   |
| apps/discord-bot/scripts/deploy-commands.test.ts | Identity, idempotence, drift, credential-safe errors and source-manifest tests.                             |
| scripts/ci/deploy-discord-commands.test.ts       | Workflow placement and executable remote-shell success/failure/stale-image tests.                           |
| package.json                                     | Append both tests to required gates.                                                                        |

Existing bot image already contains the script, tsx and dependencies. Direct tsx invocation avoids relying on pnpm-workspace.yaml, which is absent from the image. No login/global registration, Dockerfile change, delivery activation, commerce or role change.

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 2c56becfe8ff1be9dfbc2313c78d637962522bda
