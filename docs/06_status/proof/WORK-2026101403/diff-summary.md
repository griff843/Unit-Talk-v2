# Diff summary: WORK-2026101403

Execution SHA: `bcfbf571fa7002b1d581b12b3e01ef9afd3a178d`
Base SHA: `285cdb4f267d10e1eb5a460dfaf7899dd2e633a8`

| File | Change |
|---|---|
| `apps/api/src/t1-proof-utv2-1954-promotion-replay.test.ts` | Replaced the unsupported-sport fixture `WNBA` / `wnba-moneyline` with `CURLING` / `curling-moneyline`. |

`CURLING` is deliberately outside both the canonical sport mapping and the promotion scoring model. The fixture therefore leaves `picks.sport_id` null on databases with or without the WNBA catalog migration while retaining the unsupported-sport cap assertion (`<= 60`).

Read-only checks confirmed the WNBA coverage in `promotion-edge-integration.test.ts`, `alert-agent-service.test.ts`, and `canonical-reference-schema.test.ts` was not changed.

## SHA Binding

Merge SHA: c2a657ae54dfe21dd324ed4db9fec712d72adb2f
PR: https://github.com/griff843/Unit-Talk-v2/pull/1757
