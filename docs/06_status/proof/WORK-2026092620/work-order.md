# WORK-2026092620 — Operator research scripts read effective settlements, not roots

Tier: T2 · Lane type: governance · Executor: claude

Repo-owned work order (tracker independence, ratified 2026-09-05). No Linear issue exists for this identity by design.

## Objective

Production holds 12,066 correction rows in `settlement_records`. Five operator research scripts filter `.is('corrects_id', null)` and so report each corrected pick's **original** result: `scripts/roi-by-sport.ts`, `scripts/portfolio-review.ts`, `scripts/clv-dashboard.ts`, `scripts/band-accuracy.ts`, `scripts/scoring-provenance.ts`. #1634–#1636 repaired the product-path readers; this lane repairs these scripts the same way (`plan.md` §3, §6 item 7).

## Acceptance Criteria

- One shared reader (`scripts/effective-settlements.ts`) loads every record of every candidate pick's chain (paged with an ordered `range`, never trusting `.limit()` past 1000 rows) and resolves each pick through `resolveEffectiveSettlement` from `@unit-talk/domain`.
- A resolution is accepted only when every `corrects_id` target is present **and** `correction_depth + 1` equals the chain's row count (`plan.md` §9); otherwise the pick is reported as unresolved, never silently counted with its root.
- The date window selects picks by their root's settle time (the existing semantics) and never cuts a chain.
- Each of the five scripts uses the shared reader. Output shape is unchanged apart from counting effective results.
- Tests live in `scripts/roi-by-sport.test.ts` (already registered in `test:ops`; no `package.json` change): a corrected pick counts its tip result; a partial chain (missing target, or depth mismatch) is unresolved; paging reads past 1000 rows with an unstable-order fake; each script's aggregation uses the effective result.

## Out of scope

- `scripts/ops/settlement-drill.ts` reads corrections deliberately.
- `apps/api/src/scripts/utv2-592-syndicate-proof-gate.ts` (apps/api, separate lane).
- `v_governed_pick_performance` (repair is DDL, reserved).
- `apps/command-center/**` (another executor owns it).

## Guardrails

- Read-only scripts; no writes, no DDL, no credentials, no containment change.

## Exit Criteria

- PR merged on green CI; closeout through `post-merge-lane-close.yml`.
