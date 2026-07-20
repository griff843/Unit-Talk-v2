# PROOF: UTV2-1446

MERGE_SHA: PLACEHOLDER_REBIND_BEFORE_COMMIT

## Summary

Decision packet comparing Supabase-only, self-hosted (Supabase + isolated
Hetzner research host), and self-hosted-production paths for the production
DB architecture question. Recommends the hybrid architecture (Supabase OLTP
authority + one isolated Hetzner research host) as the lowest-cost
responsibly-deployable path today, per the PM's locked framing. Self-hosting
production is priced but marked ineligible now because the migration ledger
is not proven replayable and backup/PITR ownership is not staffed (per the
sibling migration-ledger-repair issue). No infrastructure, database,
migration, DNS, secret, or production-state change is made by this diff —
packet only, PM decision pending.

## ASSERTIONS:

- [x] Side-by-side 12-month cost comparison across all three options
- [x] Incident-class elimination, operational burden, and migration risk/effort documented per option
- [x] Explicit recommendation (hybrid) with trigger conditions for revisiting
- [x] PM decision record present as an explicit `PENDING` gate — no fabricated approval
- [x] No migration, infrastructure, or production-state work performed under this issue
- [x] `pnpm verify` PASS

## EVIDENCE:

```text
$ pnpm type-check
(clean, no errors)
```

```text
$ pnpm test
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
(final sub-suite shown; full aggregate `pnpm test` run exited 0)
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) -- no R-level artifacts required for this diff
```

## Scope verification

Only `docs/05_operations/DB_ARCHITECTURE_DECISION_PACKET.md` and this issue's
proof artifacts are modified. No runtime, schema, contract, domain, or
delivery files are changed.

## PM gate

Required — infra spend + production data movement, per the issue's own
acceptance criteria. `PM decision record` in the packet is explicitly
`PENDING`; this PR does not authorize procurement, migration, or any
production change.

## Tier

T2 — packet only.
