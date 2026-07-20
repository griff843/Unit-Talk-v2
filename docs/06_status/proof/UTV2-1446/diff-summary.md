# UTV2-1446 Diff Summary

Issue: UTV2-1446  
Tier: T2  
Branch: `codex/utv2-1446-db-architecture-decision-packet`

## Summary

- Adds a dated, source-linked comparison of Supabase-only, self-hosted production plus isolated research, and hybrid Supabase OLTP plus Hetzner research.
- Recommends the hybrid architecture as the lowest-cost responsibly deployable path today, while preserving an explicit future self-host eligibility gate.
- Records 12-month cash floors, incident-class effects, operational ownership, migration risk/effort, rollback, trigger conditions, and the PM decision gate.
- Makes no infrastructure, database, runtime, migration, DNS, secret, or production-state change.

## Files changed

- `docs/05_operations/DB_ARCHITECTURE_DECISION_PACKET.md` — decision packet and recommendation.
- `docs/06_status/proof/UTV2-1446/diff-summary.md` — bounded branch summary.
- `docs/06_status/proof/UTV2-1446/verification.md` — command and acceptance-criteria evidence.

The orchestrator-owned `docs/06_status/proof/UTV2-1446/model-routing.json` is generated and committed by `codex-exec` after the Codex process exits; it is intentionally not hand-authored by this lane.

## Scope

Docs-only decision and proof artifacts. No application code, schema, migration, generated database type, environment, workflow, or runtime configuration file is changed.

## R-level

Pending final verification against `origin/main`.

