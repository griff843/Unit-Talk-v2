# Diff summary: UTV2-1965

Execution SHA: `f8fa8d4b49da78e8ca801390aa785c8c85410d50`

| File                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml`               | Adds mandatory production-only Discord guild command registration after health/containment confirmation and before image cleanup. The remote shell refuses stale release metadata or a mismatched bot image, then executes the hardened deploy script inside the promoted bot container. A production `verify` preflight now refuses missing or invalid `DISCORD_GUILD_ID` before canary or activation. |
| `scripts/ci/deploy-discord-commands.test.ts` | Extracts and executes the real preflight and remote heredoc shells. Coverage includes valid/missing/invalid guild identity, success, propagated registration failure, stale release/image refusal, pre-activation placement, and the absence of canary/global registration wiring.                                                                                                                      |
| `package.json`                               | Appends the existing bot registration suite and the new workflow-shell regression to required package verification without removing any test.                                                                                                                                                                                                                                                           |

No bot source, command manifest, canary registration, global registration, containment setting,
production deployment, delivery target, role, pick, or database behavior changed.

Provenance: this is the PM-authorized replacement for the deployment slice of
`griff843/Unit-Talk-v2#1705` / UTV2-1963, preserving accepted commit
`2c56becfe8ff1be9dfbc2313c78d637962522bda` on current main after UTV2-1964/#1706 merged at
`35f9db79e85f5f67692b5ffb29ad471408c7361d` and closed at
`5051245de0b4d92d59caffbe464fb09b419ab120`.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1707
