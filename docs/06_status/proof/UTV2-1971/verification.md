# PROOF: UTV2-1971 — Verification

MERGE_SHA: pending merge

> This is pre-merge evidence. The authorized post-merge path binds the merge SHA;
> no merge, production apply, deployment, or provider/delivery activation is claimed.

Issue: UTV2-1971
Tier: T1
Lane type: migration
Proof profile: migration
Execution SHA: `82106a80506cc6204c4fa958f684ae69017d48bf`
result: pending_exact_head_ci

## ASSERTIONS:

- [x] The frozen fixture contains exactly 266 unique school-qualified participants:
      138 FBS and 128 FCS.
- [x] UUIDs are deterministic UUIDv5 values derived from NCAA organization IDs;
      reruns neither duplicate rows nor churn existing canonical identities.
- [x] The migration writes only `public.participants`, refuses identity ambiguity,
      and never writes `teams`.
- [x] The rollback targets only governed UUIDs carrying `seedIssue=UTV2-1971`,
      locks the rows, and refuses any downstream FK reference, including cascading FKs.
- [x] Current authoritative NCAA directory responses matched the frozen source hashes.
- [ ] Hosted exact-head scratch/staging migration proof and writable DB proof are pending.

## EVIDENCE:

Authoritative directory response hashes measured 2026-10-10:

```
FBS count=138 sha256=7a54773b2982b050a3141e10f14bc3cc7f8c574041e5f08afe07a3438187864c
FCS count=128 sha256=db5087dc6f788b09ff0d861764fe359ce88646a271d3cbca6a84f73c443d3e54
```

Membership reconciliation: NCAA directory truth includes New Haven (`470`) and
West Florida (`11740`); stale standings-only Saint Francis is excluded.

## Verification

- `pnpm type-check`: PASS.
- `pnpm test`: PASS.
- `pnpm exec tsx --test packages/db/src/canonical-reference-schema.test.ts`:
  PASS (25 pass, 0 fail, 1 scratch-Postgres case skipped without the CI admin URL).
- `pnpm exec tsx --test scripts/ci/participant-catalog-seed-drill.test.ts`:
  static cases PASS; 10 real-Postgres cases skipped locally without
  `PARTICIPANT_CATALOG_TEST_ADMIN_URL`.
- `pnpm verify:commands`: PASS; migration versions and lint clean.
- `pnpm test:db`: correctly REFUSED before mutation because the local target resolved
  to `127.0.0.1/unidentified`, not staging project `xskgrzbteyqdufktjrjx`.
- `pnpm verify:static`: final result pending while this artifact is prepared.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
  pending final proof commit.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=`unparseable`). Writable DB verification requires
`xskgrzbteyqdufktjrjx`; it must run through the `staging-ci` GitHub environment
with `CI_SUPABASE_*` credentials. No local guard was bypassed and no DB was mutated.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 82106a80506cc6204c4fa958f684ae69017d48bf
