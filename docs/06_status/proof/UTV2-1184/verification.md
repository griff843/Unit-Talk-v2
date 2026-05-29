# UTV2-1184 — CR-5 Verification

## Summary

Wire `test:t1-proof` into `pnpm verify`. All T1 governance proof tests now execute inside the verify gate and block CI on regression.

Branch SHA (last code change): `1dd15c84cd71234523196094d1f4a8b3a4ff57d5`

## Verification

| Command | Result | Notes |
|---|---|---|
| `pnpm verify` | PASS | Full chain including test:t1-proof |
| `pnpm test:t1-proof` | PASS | All governance proof tests pass |
| `pnpm type-check` | PASS | TypeScript clean |
| `pnpm lint` | PASS | ESLint clean |
| `pnpm test:db` | PASS | 7 live DB smoke tests, 0 failures |
| R-level check | PASS | No R-level artifacts required |

## Governance proof tests now enforced

- t1-proof-utv2-1107 (FSM trigger): PASS
- t1-proof-utv2-1108 (authority matrix): PASS
- t1-proof-utv2-1109 (dual-auth): PASS
- t1-proof-utv2-1110 (approval expiration): PASS
- t1-proof-utv2-1111 (governance rollback): PASS
- t1-proof-utv2-1181 (cross-domain enforcement): PASS
- t1-proof-utv2-1182 (expiry boundary): PASS
- t1-proof-utv2-1183 (terminal rollback states): PASS

## pnpm verify tail

```text
> pnpm test:t1-proof (final segment)
# pass 20
# fail 0

> @unit-talk/v2@0.1.0 verify:commands
> pnpm --filter @unit-talk/discord-bot command-manifest:check && node scripts/check-migration-versions.mjs && node scripts/lint-migrations.mjs

[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 114 migration file(s) verified — no duplicate versions.
[lint-migrations] 114 migration file(s) checked — no findings.
```
