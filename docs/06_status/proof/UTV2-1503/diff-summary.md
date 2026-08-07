# DIFF SUMMARY: UTV2-1503 — Orchestrator Standing Authority Narrowing

MERGE_SHA: pending

## Scope

Documentation-only lane. One substantive file; the remainder is lane apparatus
and proof.

| File | Change | Lines |
|---|---|---|
| `docs/06_status/audits/UTV2-1503-orchestrator-standing-authority-narrowing.md` | added | +158 |
| `docs/06_status/lanes/UTV2-1503.json` | lane manifest | apparatus |
| `docs/06_status/proof/UTV2-1503/evidence.json` | evidence bundle | proof |
| `docs/06_status/proof/UTV2-1503/verification.md` | verification log | proof |
| `docs/06_status/proof/UTV2-1503/diff-summary.md` | this file | proof |
| `.ops/sync/UTV2-1503.yml` | sync record | apparatus |

`git diff --stat origin/main...HEAD` excluding proof, lane and sync paths:
**1 file changed, 158 insertions(+)**.

## What the substantive file does

Records the decision narrowing the orchestrator's standing authority. It is an
audit/decision document under `docs/06_status/audits/`. It adds no runtime code,
no schema, no workflow, and no governance enforcement — the narrowing it
describes is enacted by the controls that already exist, not by this file.

## Risk assessment

- **Runtime surface:** none. No file under `apps/`, `packages/`, `scripts/`,
  `.github/workflows/` or `supabase/migrations/` is touched.
- **Schema/DDL:** none.
- **Reversibility:** fully reversible — a documentation revert restores the
  prior state with no migration or data implication.
- **Blast radius:** confined to the audit record.

## Why this file exists

Added during the close-eligibility repair. The lane's own preflight
(`CEP-E4/P11`) blocked it pre-merge:

```
[FAIL] CEP-E4/P11  proof must include a diff summary file
[FAIL] CEP-C1      ops:lane-close would fail after merge on: CEP-E4/P11, CEP-E4/P12
```

The requirement is real and was genuinely unmet — this lane's proof bundle
carried `evidence.json` and `verification.md` but no diff summary, so
`ops:lane-close` would have failed after the merge in the same way UTV2-1619's
did. The gap was closed by supplying the missing artifact, not by relaxing the
check.
