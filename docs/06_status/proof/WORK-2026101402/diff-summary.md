# WORK-2026101402 Diff Summary

Execution SHA: `3ede34fb4bb94b5642bf925aaa17c76f0b6c9992`<br>
Diff base: `c6f007a81bd6083db8233ec6f74a734659e7bda8` (`origin/main`)<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1755

## What changed

- Added WNBA to the API validation guard, mirrored Smart Form guard, and team-sport UI set.
- Added WNBA to the in-memory reference catalog with basketball stat types and no static teams.
- Added canonical WNBA sport derivation for metadata and `wnba-*` markets, with explicit
  moneyline, spread, and total aliases. The WNBA prefix is checked before NBA.
- Added coverage for two-participant Smart Form admission, API-side governed participant
  resolution, Track Only containment, `sport_id = 'WNBA'`, the 10-sport catalog, and NBA/WNBA
  derivation separation.
- Preserved unsupported WNBA scoring and inactive alert behavior; no domain scoring, alert
  enablement, migration, provider, delivery, Discord, or kill-switch code changed.

## Changed implementation files

| File | Change |
|---|---|
| `apps/api/src/smart-form-validation.ts` | Accept WNBA as a team sport. |
| `apps/api/src/server.test.ts` | Prove the 10-sport catalog and in-memory governed WNBA Track Only persistence. |
| `apps/smart-form/lib/form-utils.ts` | Mirror WNBA in the client submission guard. |
| `apps/smart-form/app/submit/components/BetForm.tsx` | Treat the WNBA selector as a team sport. |
| `apps/smart-form/test/api-client.test.ts` | Prove WNBA requires two distinct entered participants. |
| `packages/contracts/src/reference-data.ts` | Add the in-memory WNBA catalog entry. |
| `packages/db/src/pick-foreign-keys.ts` | Derive WNBA sport and market foreign keys. |
| `packages/db/src/pick-foreign-keys.test.ts` | Prove metadata, prefix, alias, and NBA separation behavior. |

The repo-owned `.ops/work/WORK-2026101402.md`, lane-link metadata, and this named proof directory
are governance artifacts. The packet explicitly authorizes the work order and proof paths; the
machine scope lock enumerates only the eight implementation files. Run after the separate proof
commit, `ops:scope-diff` therefore reports the lane manifest and four required proof paths as
governance-path bleed and reports the implementation locks unused because it inspects that commit.

## SHA Binding

Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1755
