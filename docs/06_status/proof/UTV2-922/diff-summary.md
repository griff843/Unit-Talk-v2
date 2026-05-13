# UTV2-922 Diff Summary

## Scope

- Added `scripts/ci/required-db-smoke.ts`: evaluates DB smoke required/skipped/pass/fail based on branch ref and credential presence.
- Added `scripts/ci/required-db-smoke.test.ts`: 6 unit tests covering all evaluation paths.
- Added `pnpm ci:db-smoke` script in `package.json` wiring to `tsx scripts/ci/required-db-smoke.ts`.
- Updated `.github/workflows/ci.yml`:
  - Injected Supabase credentials from GitHub secrets (previously empty strings).
  - Injected `COMMAND_CENTER_AUTH_TOKEN`, `AUTH_SECRET`, `NEXTAUTH_SECRET` for build-time validation.
  - Replaced separate lint/type-check/build/test steps with `pnpm verify`.
  - Added `pnpm test:command-center` as an explicit step.
  - Replaced bare `pnpm test:db` with `pnpm ci:db-smoke` (enforces required/skip logic).
  - Added CI truth summary step (`if: always()`).

## Verification

- `pnpm verify` passed (113 tests, 0 failures) on the UTV2-918+922 combined branch.
- `required-db-smoke.test.ts`: 6/6 tests pass.
- `pnpm test:db` not independently required for this T2 lane (no DB service layer or migration files changed).

## R-level Notes

- CI is triggered by `.github/workflows/ci.yml` change.
- No operator-ui, discord-delivery, or migration-audit R-levels triggered.
