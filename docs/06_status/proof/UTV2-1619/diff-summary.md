# UTV2-1619 diff summary — governance bootstrap authorization (capability 18)

MERGE_SHA: 9722ef7120fcb98f7287a7d5ab03fbbe65813fa2

- Added `scripts/ops/bootstrap-authorization.ts`: reads a named, expiring, governance-only
  admission grant from `origin/main` and decides whether it admits a lane.
- Added `docs/governance/BOOTSTRAP_AUTHORIZATIONS.json` carrying exactly one grant, for
  UTV2-1619, expiring 2026-09-05.
- Wired the decision into `scripts/ops/lane-start.ts` at the existing concurrency refusal
  point. Cap violations covered by a valid grant are suppressed; every structural violation
  and every other rule is unchanged.
- Success output gains `admitted_under_bootstrap_authorization`, naming the grant and the
  exact violations it suppressed, so an authorized admission is never indistinguishable from
  an ordinary one.
- Added 17 unit tests, weighted toward refusal paths.

No production code, no runtime path, no migration, no workflow, no delivery path is touched.
