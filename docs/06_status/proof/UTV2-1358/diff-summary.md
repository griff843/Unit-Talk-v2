# UTV2-1358 Diff Summary — M5 grading-staleness-check.yml fix

## Root Cause

`.github/workflows/grading-staleness-check.yml` used `run: tsx scripts/grading-alert-check.ts`
directly in the GHA step. After `pnpm install --frozen-lockfile`, `tsx` is installed into
`node_modules/.bin/` but is **not** on the system PATH in a GitHub Actions runner. GitHub Actions
reports this class of immediate runner failure as "This run likely failed because of a workflow
file issue."

This is confirmed by the working pattern used elsewhere:
- `ops-burn-in-monitor.yml` → `pnpm exec tsx scripts/ops/burn-in-snapshot.ts` ✓
- `ingestor-staleness-alert.yml` → `pnpm ingestor:alert-check` (named pnpm script) ✓
- `grading-staleness-check.yml` → `tsx scripts/grading-alert-check.ts` (bare, broken) ✗

## Changes

### `.github/workflows/grading-staleness-check.yml`

Changed step command from:
```yaml
run: tsx scripts/grading-alert-check.ts
```
to:
```yaml
run: pnpm exec tsx scripts/grading-alert-check.ts
```

`pnpm exec` resolves the binary from `node_modules/.bin/` (where tsx lives after `pnpm install`),
making it available without requiring tsx on the global PATH.

### `package.json`

Added `grading:alert-check` script for consistency with the alert-check naming convention
(`ingestor:alert-check`, `worker:alert-check`, `disk:alert-check`):

```json
"grading:alert-check": "tsx scripts/grading-alert-check.ts"
```

This enables running the check locally via `pnpm grading:alert-check` and also allows the
workflow to be switched to `pnpm grading:alert-check` in a future cleanup (both patterns work).

## Non-changes

- `scripts/grading-alert-check.ts`: No changes required. `loadEnvironment()` from
  `@unit-talk/config` reads `process.env` first (before `.env*` files), so GHA secrets injected
  via `env:` are correctly picked up. The `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` webhook is already
  gracefully optional — `postDiscordAlert()` returns early if the env var is not set, so missing
  webhook secret is non-fatal.
- No new GHA secrets required.
