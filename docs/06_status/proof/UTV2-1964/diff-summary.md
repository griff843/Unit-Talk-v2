# Diff summary: UTV2-1964

Execution SHA: `9097cfc0b1dac0598c8cc64d99f17115494255ce`

| File | Change |
|---|---|
| `apps/discord-bot/scripts/deploy-commands.ts` | Refuses empty manifests, validates the token application identity, performs guild-only full replacement, reads the guild registry back, verifies count/name/application/guild and every authored command field, and logs a credential-safe failure. |
| `apps/discord-bot/scripts/deploy-commands.test.ts` | Covers idempotent full replacement, wrong-token and empty-manifest refusal, write/read failures, inventory drift, Discord default omission, checked-in manifest parity, and safe CLI import/error behavior. |
| `apps/discord-bot/package.json` | Adds the PM-authorized package test command so the focused registration suite is executable and discoverable by the repository wiring guard. |

No global command registration, deployment workflow, production registration, role mutation, pick,
receipt, or delivery-switch behavior changed.

## SHA Binding

Merge SHA: 35f9db79e85f5f67692b5ffb29ad471408c7361d
PR: pending
