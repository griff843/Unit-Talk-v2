# Week 15 Failure / Rollback Template

## Metadata

| Field | Value |
|---|---|
| Week | 15 — Probability & Devig Math Salvage |
| Template status | Pre-implementation (fill in only if failure occurs) |
| Authority | `docs/05_operations/week_15_probability_devig_salvage_contract.md` |

---

## Halt Conditions

Record a failure and halt if any of the following occur:

1. `pnpm test` drops below 100 (Week 14 baseline)
2. `pnpm verify` fails after implementation
3. Any probability function produces side effects (DB writes, I/O, logging to external service)
4. File imports Supabase, Express, or any runtime/I/O dependency
5. A rejected module (offerFetch, KellySizer, expectedValue agent code) is accidentally ported
6. Changes are made to existing app runtime code (apps/api, apps/worker, apps/operator-web, apps/smart-form routes/services)
7. Math produces different results from old canonical source on identical inputs

---

## Failure Record

| Field | Value |
|---|---|
| Failure detected at | |
| Failing check | |
| Error message / evidence | |
| Root cause | |

---

## Revert Checklist

If rollback is required:

- [ ] Delete `packages/domain/src/probability/` directory entirely
- [ ] Revert `packages/domain/src/index.ts` to remove probability re-export
- [ ] Remove probability test files from root `package.json` test command
- [ ] Run `pnpm test` — confirm 100/100 (Week 14 baseline)
- [ ] Run `pnpm test:db` — confirm 1/1
- [ ] Run `pnpm verify` — confirm clean
- [ ] Record the failure reason in this template

---

## Post-Revert State Checks

| Check | Expected | Result |
|---|---|---|
| `packages/domain/src/probability/` does not exist | confirmed | |
| `packages/domain/src/index.ts` does not export probability | confirmed | |
| Root test command does not reference probability test files | confirmed | |
| `pnpm test` | 100/100 | |
| `pnpm test:db` | 1/1 | |
| `pnpm verify` | clean | |
| No partial probability code left behind | confirmed | |
