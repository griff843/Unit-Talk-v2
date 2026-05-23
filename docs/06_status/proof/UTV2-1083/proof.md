# Proof: UTV2-1083 — INIT-1.1.0 Reversible Migration Capability

## Summary

Phase A additive scaffolding for reversible migration infrastructure. Deliverables:

- `scripts/ci/migration-reversibility-gate.ts` — fail-closed CI gate (exit 0/1/2)
- `scripts/ci/schema-roundtrip-hash.ts` — pg_dump schema hash for round-trip comparison
- `scripts/ci/migration-reversibility-gate.test.ts` — 7 adversarial fixtures
- `db/migrations-rollback/irreversible-exemption-registry.json` — PM-ratified IRREVERSIBLE record
- `.github/workflows/migration-reversibility-gate.yml` — presence check + round-trip drill

Schema v2 proof binding:
- `verified_source_sha`: `46c9abc816de27f1719c1fbb65301d9d5ab62924`
- Last substantive commit: workflow grep fix, ON_ERROR_STOP=1, invalid-SQL adversarial fixture
- Post-substantive commits: evidence.json only (verified by proof-binding-validator)

## Evidence

```text
pnpm verify: PASS (lint + type-check + build + test — all packages)

pnpm test:db: 7/7 PASS (live Supabase, retry 2 — first run had transient network failure)

Adversarial gate fixtures (scripts/ci/migration-reversibility-gate.test.ts):
  ok 1 - F1: missing down script — gate FAILS with exit 1
  ok 2 - F2: comment-only down script — gate FAILS with exit 1
  ok 3 - F3: IRREVERSIBLE without ratification record — gate FAILS with exit 1
  ok 4 - F4: unresolvable base ref — gate exits 2 (infra error, not silent pass)
  ok 5 - F5: valid reversible down script — gate PASSES with exit 0
  ok 6 - F6: IRREVERSIBLE with ratification record — gate PASSES with exit 0
  ok 7 - F7: zero new migrations — gate PASSES with exit 0
  # pass 7 / fail 0

migration-reversibility-gate local run (zero-migration PR):
  migration-reversibility-gate: no new migrations — PASS

IRREVERSIBLE exemption registry: 2 PM-ratified entries
  - 202605120001_utv2_883_link_market_universe_participant_ids
  - 202605130002_utv2_920_db_invariant_rpc_guards

proof-binding-validator (schema v2):
  verified_source_sha: 46c9abc816de27f1...
  evidence_commit_sha: 69237b05bef7fa71... (resolved by CI from git log)
  current_pr_head_sha: (resolved by CI from GITHUB_SHA at runtime)
  proof-binding-validator: PASS
```

## Verification

Binding integrity: `verified_source_sha` `46c9abc8` is an ancestor of PR head. All commits
between `verified_source_sha` and HEAD touch only `docs/06_status/proof/UTV2-1083/evidence.json`
— verified mechanically by `scripts/ci/proof-binding-validator.ts`.

Gate correctness: adversarial fixtures prove the gate exits 1 for each negative case (missing
down, comment-only, unratified IRREVERSIBLE) and exits 2 for infra errors (invalid base ref).
The round-trip workflow proves psql rejects invalid SQL via `ON_ERROR_STOP=1`.

Constitutional invariant closed: INV-0013 — no truth-surface migration without tested rollback.
Audit gap closed: #40.
