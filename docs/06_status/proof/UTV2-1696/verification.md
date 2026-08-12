# UTV2-1696 Verification

## Verification

- `pnpm type-check` passed.
- `pnpm exec tsx --test 'scripts/ops/lease-registry.test.ts'` passed: 27 tests,
  including a fresh-heartbeat terminal-manifest orphan regression.
- `pnpm test` and `pnpm verify:static` were started, but overlapping aggregate
  runs exceeded the interactive window and were stopped. The draft PR's CI is
  the required authoritative full-gate run before merge.

Writable live-DB proof is blocked/deferred: target identity could not be
resolved from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`; run it through the staging-ci GitHub environment with
`CI_SUPABASE_*` credentials.
