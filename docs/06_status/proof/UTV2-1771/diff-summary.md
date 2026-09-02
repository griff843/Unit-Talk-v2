# UTV2-1771 diff summary

MERGE_SHA: null

## Summary

- Adds a fail-closed preservation CLI for the eight June 23–30
  `provider_offer_history` partitions.
- Exports canonical ordered CSV, encrypts it, stores immutable
  content-addressed objects in the established private Cloudflare R2 backup
  bucket, and verifies every object by downloading and decrypting it.
- Restores all eight objects into the identity-locked staging schema and emits
  `PASS` only after source counts remain unchanged, restored counts and
  re-exported checksums match, and a second run proves idempotent replay.

## Files changed

- `scripts/ops/preserve-june-offer-history.ts` — preservation, restore,
  reconciliation, receipt generation, safety guards, and focused `node:test`.
- `docs/06_status/proof/UTV2-1771/verification.md` — pre-implementation storage,
  restore-target, and receipt contract plus verification evidence.
- `docs/06_status/proof/UTV2-1771/evidence.json` — script-generated fail-closed
  prerequisite receipt; hosted execution must replace its deferred verdict.

## Safety boundary

The production connection is accepted only when its URL resolves to project
`zfzdnfwdarxucxtaojxm`; it is used only for catalog `SELECT`, exact `count(*)`,
and `COPY (SELECT ...) TO STDOUT`. Schema creation, table replacement, and
`COPY FROM STDIN` use a separate connection that must resolve to staging project
`xskgrzbteyqdufktjrjx`. No `packages/db/**`, retention, queue, delivery,
provider-subscription, or runtime-parking path is touched.

## Verification

Focused command:

```text
npx tsx --test scripts/ops/preserve-june-offer-history.ts
```

Required gates:

```text
pnpm verify:static
pnpm test:db
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```
