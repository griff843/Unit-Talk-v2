# Diff Summary — UTV2-1831

**Issue:** UTV2-1831 — wire the stake-units live proof so it can execute
**Branch:** `claude/utv2-1831-stake-units-proof-wiring`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1504
**Tier:** T2
**Lane type:** modeling

MERGE_SHA: pending merge

## Files changed

| File | Change | Why |
|---|---|---|
| `apps/api/src/t1-proof-utv2-1815-stake-units.test.ts` | added | the live proof suite; asserts against real staging rows that a canonical stake persists `profitLossUnits` and that a historical unknown stake is reported as unknown rather than silently defaulted |
| `package.json` | 1 line | appends the suite to `test:t1-proof:live`, which is what the `Writable DB proof (staging only)` CI job runs |
| `docs/05_operations/db-writer-classification.json` | +5 lines | classifies the suite (`owner: api`, execution `pnpm test:t1-proof:live`); without this entry `scripts/ci/db-writer-inventory.ts` fails the repository on an unclassified credentialed DB test |

No product code is touched. No behaviour changes. No schema, migration, contract or
governance file is modified.

## Why this is a separate PR from the change it serves

The suite was authored on `#1479`, where it could not run: nothing invoked it, and the
writer-inventory guard rejects an unclassified credentialed DB test outright. Landing the
wiring there was not available either —
`.github/workflows/shadow-parity-required.yml` pins `package.json` against modification
for any PR that touches its trigger paths, and states the remedy in its own comment:

> None of these are in this workflow's trigger paths, so pinning them costs the check
> nothing: a PR touching both must land them separately.

None of the three files here match that workflow's trigger paths, and
`.github/workflows/live-schema-parity.yml` does not pin `package.json`. The split is the
sequencing the control documents, not a way around it.

## Production-credential boundary

Unchanged. The suite runs only under `test:t1-proof:live`, whose first step is
`pnpm ci:assert-staging`; it is reachable from no other script, which is exactly what its
`db-writer-classification.json` entry declares and what `db-writer-inventory` verifies.
