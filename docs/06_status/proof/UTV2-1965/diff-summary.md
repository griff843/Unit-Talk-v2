# Diff summary: UTV2-1965

Execution SHA: `b1fc2fe2fb3bb99beca507270200f0b832dea241`

| File                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml`               | Adds mandatory production-only Discord guild command registration after health/containment confirmation and before image cleanup. The remote shell refuses stale release metadata or a mismatched bot image, then executes the hardened deploy script inside the promoted bot container. A production `verify` preflight now refuses missing, zero, leading-zero, malformed, and above-uint64 `DISCORD_GUILD_ID` values before canary or activation. |
| `scripts/ci/deploy-discord-commands.test.ts` | Extracts and executes the real preflight and remote heredoc shells. Coverage includes the selected production ID, uint64 max, zero/all-zero, 20 nines, max+1, malformed and whitespace identities, plus registration success/failure, stale release/image refusal, pre-activation placement, and the absence of canary/global registration wiring.                                                                                                   |
| `package.json`                               | Appends the existing bot registration suite and the new workflow-shell regression to required package verification without removing any test.                                                                                                                                                                                                                                                                                                        |

No bot source, command manifest, canary registration, global registration, containment setting,
production deployment, delivery target, role, pick, or database behavior changed.

Provenance: this is the PM-authorized replacement for the deployment slice of
`griff843/Unit-Talk-v2#1705` / UTV2-1963, preserving accepted commit
`2c56becfe8ff1be9dfbc2313c78d637962522bda` on current main after UTV2-1964/#1706 merged at
`35f9db79e85f5f67692b5ffb29ad471408c7361d` and closed at
`5051245de0b4d92d59caffbe464fb09b419ab120`.

## SHA Binding

Merge SHA: 41d659c36cec45c622cbcaaa16fa5ae28bdb1b27
PR: https://github.com/griff843/Unit-Talk-v2/pull/1707
