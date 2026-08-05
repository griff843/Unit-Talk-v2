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
- Added `tier` to the bootstrap identity, validated against T1/T2/T3 — an invented tier
  invalidates the file rather than defaulting.
- Taught Merge Gate to resolve a tier from a bootstrap governance identity when, and only
  when, no lane manifest resolves one, and to report that admission distinctly instead of
  passing it with the ordinary summary.
- A bootstrap admission now writes a committed receipt at
  `docs/06_status/proof/<ISSUE>/bootstrap-admission-receipt.json` recording the grant
  verbatim, the exact `main` commit it was read from, the suppressed violations, and the
  board at admission.
- Added 22 unit tests, weighted toward refusal paths, and wired them into `test:ops` so
  `pnpm test` actually executes them (CI's executable-wiring guard rejected the first
  attempt, in which the tests existed but ran nowhere).

No production code, no runtime path, no migration, and no delivery path is touched. The only
workflow change is Merge Gate's tier-resolution block.
