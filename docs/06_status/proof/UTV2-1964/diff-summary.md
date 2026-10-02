# Diff summary: UTV2-1964

Execution SHA: `4bc8f3d6b3e9c71fcaf8a07d0d02ff2ad06ae704`

| File | Change |
|---|---|
| `apps/discord-bot/scripts/deploy-commands.ts` | Refuses empty manifests, validates the token application identity, performs guild-only full replacement, reads the guild registry back, verifies count/name/application/guild and every authored command field, and logs a credential-safe failure. |
| `apps/discord-bot/scripts/deploy-commands.test.ts` | Covers idempotent full replacement, wrong-token and empty-manifest refusal, write/read failures, inventory drift, Discord default omission, checked-in manifest parity, and safe CLI import/error behavior. |

No global command registration, deployment workflow, package manifest, production registration,
role mutation, pick, receipt, or delivery-switch behavior changed.

## SHA Binding

Merge SHA: pending merge
PR: pending
