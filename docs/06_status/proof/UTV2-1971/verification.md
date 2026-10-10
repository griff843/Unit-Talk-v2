# PROOF: UTV2-1971 — Verification

MERGE_SHA: pending merge

> This is pre-merge evidence. The authorized post-merge path binds the merge SHA;
> no merge, production apply, deployment, or provider/delivery activation is claimed.

Issue: UTV2-1971
Tier: T1
Lane type: migration
Proof profile: migration
Execution SHA: `82106a80506cc6204c4fa958f684ae69017d48bf`
Verified source SHA: `d859fec024e2601eba112c896467fde3b2c68f4a`
result: pass_pending_pm_approval

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
- [x] Hosted exact-head scratch/staging migration proof, writable DB proof, live
      schema parity, and required verify all passed.

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
- `pnpm verify:static`: PASS locally and in exact-head CI.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
  PASS; changed files 10, no R-level rules matched.

Hosted exact-head receipts at `d859fec024e2601eba112c896467fde3b2c68f4a`:

- Participant fail-closed seed drill: PASS — run `38089100046`, job `114321669432`.
- Schema apply/rollback/reapply round trip: PASS — run `38089100046`, job `114321669440`.
- Sanctioned staging writable DB proof and T1 live suites: PASS — run
  `38089100054`, job `114321782207`.
- Required `verify`, including static verification and same-run DB receipt validation:
  PASS — run `38089100054`, job `114323326879`.
- Live schema parity: PASS — run `38089100058`, job `114321695360`; this proves
  schema parity and does not claim the participant data was applied to production.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=`unparseable`). Writable DB verification requires
`xskgrzbteyqdufktjrjx`; it must run through the `staging-ci` GitHub environment
with `CI_SUPABASE_*` credentials. No local guard was bypassed. Disposable loopback Postgres was deliberately mutated for the approved seed and concurrency drills; no production database was mutated.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1730
Execution SHA: 82106a80506cc6204c4fa958f684ae69017d48bf

## Independent executor review evidence

Primary review supplied the frozen roster input and corrected the draft rollback race within the approved paths. The sanctioned Codex CLI authored the initial migration/tests and retains its own model receipt.

```
Disposable PostgreSQL 18.6 on loopback, approved scratch database names only:
Focused canonical-reference-schema tests: 26 PASS, 0 FAIL, 0 SKIP
Concurrent FK insertion during rollback: refused with SQLSTATE 55P03
Reference committing while rollback waits: rollback refused with SQLSTATE P0001
Exact participant snapshot and downstream reference preserved on refusal
Actual candidate seed drill: all eight reported phases PASS after row-lock correction
Post-correction scoped ESLint and type-check: PASS
```

Ignored local transcripts: `.out/production-resume-20261009/ncaaf-focused-postgres.log`, `ncaaf-actual-seed-drill.log`, `ncaaf-rollback-concurrency-proof.json`. Scratch databases were removed after each test. The optional concurrency regression ran locally with a disposable admin URL; this does not claim it ran in hosted CI.

## Machine-verified source identity

This Git output supersedes conflicting primary checkpoint notes that mistook a draft sidecar value for the source commit. It changes no implementation.

```
git rev-parse 82106a805
82106a80506cc6204c4fa958f684ae69017d48bf
git cat-file -t 82106a80506cc6204c4fa958f684ae69017d48bf
commit
```
