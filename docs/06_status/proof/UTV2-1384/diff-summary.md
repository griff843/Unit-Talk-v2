# UTV2-1384 Diff Summary

## Summary

Audit-only, read-only lane (DEBT-001): mapping every read/write/join across the old participant system (`participants`, `participant_memberships`) and the new system (`leagues`, `teams`, `players`, `player_team_assignments`), identifying silent correctness risks, and producing a PM decision packet with two remediation options. No source code is modified under this lane — the only output artifact is `docs/06_status/audits/participant-system-audit.md`.

## Files Changed

- `docs/06_status/audits/participant-system-audit.md` (new) — the audit + decision packet.
- `docs/06_status/proof/UTV2-1384/evidence.json` (new) — T1 evidence bundle.

## Headline Finding

The "new" canonical participant system (`teams`, `player_team_assignments`: 0 rows each; `players`: 12 rows, all from a schema round-trip proof test) is dormant scaffolding, not a live parallel system — grading/CLV/settlement exclusively and correctly use the old system today, with a consistent fail-closed (grading) / fail-open-to-null (CLV, settlement) pattern on ambiguous participant matches. Full findings and the decision packet are in the audit doc.

## Scope Notes

- No runtime, domain, contract, DB schema, or migration paths were changed — this lane produces an audit document only, per the issue's explicit note ("audit-only; read-only inspection of existing tables/queries allowed, no source edits under this lane").
- Migration implementation (if a PM decision selects Option B) is explicitly a separate, future T1 lane requiring its own PM approval.
