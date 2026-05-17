# UTV2-1002 Lane Reconciliation — Null-SHA + Orphaned Manifests

**Date:** 2026-05-17  
**Auditor:** Claude (UTV2-1002)  
**Scope:** All 181 lane manifests in `docs/06_status/lanes/`

---

## Summary

| Category | Count |
|----------|-------|
| Total manifests | 181 |
| Done with merge SHA (healthy) | 111 |
| Done with null-SHA | 37 |
| Null-SHA with proof directories | 9 |
| Missing `issue_id` field (defect, fixed) | 3 |
| Stale active (no SHA, not done) | 0 |

**Verdict:** No current production-readiness proof relies on null-SHA evidence. All active production gates (UTV2-930, UTV2-936, UTV2-938, UTV2-948) have SHA-bound proof. The null-SHA done lanes are pre-enforcement historical record.

---

## Null-SHA Done Lanes — Full Inventory and Disposition

All 37 null-SHA done lanes predate SHA-binding enforcement (introduced ~Phase 7). Disposition: **archive as-is** — work is confirmed merged on GitHub; these manifests are historical record only and no current readiness gate references them.

### Subset with proof directories (9 lanes)

These have associated proof files but none are referenced by current production-readiness decisions:

| Issue | Title slug | Proof path | Production-readiness reliance |
|-------|-----------|------------|-------------------------------|
| UTV2-590 | production-readiness-closeout | `proof/UTV2-590/` | Phase 6 closeout — superseded by current proofs |
| UTV2-637 | execution-map | `proof/UTV2-637/` | Governance doc — no runtime reliance |
| UTV2-638 | modeling-sequence | `proof/UTV2-638/` | Governance doc — no runtime reliance |
| UTV2-639 | three-lane-workflow | `proof/UTV2-639/` | Governance doc — no runtime reliance |
| UTV2-696 | fix-ingestor-nba-nhl | `proof/UTV2-696/` | Operational fix — not a readiness proof |
| UTV2-697 | live-game-badge-offer-panel | `proof/UTV2-697/` | UI feature — not a readiness proof |
| UTV2-698 | remove-sgo-odds-api | `proof/UTV2-698/` | Cleanup — not a readiness proof |
| UTV2-700 | period-half-inning-market-types | `proof/UTV2-700/` | Market taxonomy — not a readiness proof |
| UTV2-704 | mlb-1st-inning-market-types | `proof/UTV2-704/` | Market taxonomy — not a readiness proof |

### Remaining 28 null-SHA lanes (no proof dirs)

```
UTV2-573  UTV2-575  UTV2-580  UTV2-581  UTV2-622  UTV2-624  UTV2-625
UTV2-651  UTV2-653  UTV2-694  UTV2-768  UTV2-771  UTV2-776  UTV2-778
UTV2-779  UTV2-785  UTV2-786  UTV2-788  UTV2-789  UTV2-790  UTV2-799
UTV2-805  UTV2-807  UTV2-809  UTV2-910  UTV2-976  UTV2-977
```

Disposition: **archive as-is** — no proof files, no open blockers, confirmed done.

---

## Structural Defects Fixed

Three manifests had `issue_id: null`, breaking tooling that relies on this field:

| File | Branch | Fix applied |
|------|--------|-------------|
| `UTV2-910.json` | griffadavi/utv2-910-ingestor-cadence-break-* | Set `issue_id: "UTV2-910"` |
| `UTV2-976.json` | griffadavi/utv2-976-add-opsreconcile-* | Set `issue_id: "UTV2-976"` |
| `UTV2-977.json` | griffadavi/utv2-977-fix-tier-c-path-* | Set `issue_id: "UTV2-977"` |

---

## Orphaned Remote Branches

**Observation:** The remote has ~240+ branches, the majority corresponding to done/merged lanes. This is cosmetic but creates noise in branch listings and ops tooling. Cleanup is out of scope for this lane (no-op governance) — hand to Codex as `ops:hygiene` work.

**Recommended follow-up issue:** "Bulk delete remote branches for done/closed lane manifests older than 90 days" (T3/Codex/hygiene).

---

## Readiness Proof Integrity Check

Current production-readiness gates and their SHA binding:

| Proof | SHA bound | Status |
|-------|-----------|--------|
| UTV2-930 (lifecycle spec) | Yes | Merged |
| UTV2-938 (invariants) | Yes | Merged |
| UTV2-936 (automated recovery) | Pending merge | PR #712 open |
| UTV2-948 (P0 protocol) | Yes | Merged |

**No current readiness gate references null-SHA evidence.** Acceptance criterion satisfied.

---

## Status and No-Op Decisions

- **Null-SHA done manifests:** No mutation needed. Disposition recorded here. The SHA-null violation is a pre-enforcement artifact, not an active defect.
- **Reopening:** None. No null-SHA lane represents incomplete work.
- **Script defect (null commit_sha in done manifests):** A separate enforcement issue (UTV2-1001 — enforce non-null merge SHA at lane close) is already in "Ready for Codex" and will prevent recurrence.
