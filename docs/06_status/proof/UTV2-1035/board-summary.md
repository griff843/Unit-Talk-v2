# Board Truth Reset — UTV2-1035

**Project:** UTV2-980 Production Readiness + Elite Syndicate Audit Remediation  
**Audit date:** 2026-05-21  
**Auditor:** Claude (T2 governance lane)  
**Branch:** `claude/utv2-1035-board-truth-reset`

---

## System-Level Statements

**Production readiness: NOT READY until M7 (72h Production Burn-In) passes.**

M7 has zero issues assigned. No continuous 72h live-host burn-in has been run or documented. Milestone progress reported as "100%" in Linear is incorrect — the burn-in has not occurred. No production-readiness claim is valid until M7 completes with a timestamped, SHA-bound evidence artifact.

**Syndicate readiness: NOT CREDIBLE until M8 (Syndicate Edge Accumulation) passes.**

M8 is 40% complete. Only 5 real-edge-backed settled picks exist in the production dataset (vs. 50 minimum for any non-INSUFFICIENT_DATA verdict per UTV2-1000). Model edge verdict from UTV2-1000 is explicitly `INSUFFICIENT_DATA`. No syndicate-readiness, elite-model, or winning-edge claim may be made.

---

## Classification Table — All 43 Done Issues

| Issue | Title | Milestone | Tier | Classification | Risk |
|-------|-------|-----------|------|----------------|------|
| UTV2-952 | Pre-existing flaky test: /health UUID probe | — | — | mechanism implemented | LOW |
| UTV2-954 | alert-agent validator integration P0 | — | — | mechanism implemented | LOW |
| UTV2-962 | Reconcile canonical lane/execution-state registries | — | — | mechanism implemented | LOW |
| UTV2-964 | Standardize reusable workflow skill registry | — | — | mechanism implemented | LOW |
| UTV2-967 | Add agent and skill schema contracts | — | — | mechanism implemented | LOW |
| UTV2-968 | Implement recommend-only lane maximization | — | — | mechanism implemented | LOW |
| UTV2-969 | Generate standardized execution packets | — | T2 | mechanism implemented | LOW |
| UTV2-970 | Restructure manifest housekeeping (skip-ci) | — | T3 | mechanism implemented | LOW |
| UTV2-971 | Generate standardized PR review packets | — | T2 | mechanism implemented | LOW |
| UTV2-972 | Implement lane closeout orchestration | — | T2 | mechanism implemented | LOW |
| UTV2-973 | Add merge-risk and blocked-lane analysis | — | T2 | mechanism implemented | LOW |
| UTV2-974 | Add execution-state observability dashboard/spec | — | T2 | mechanism implemented | LOW |
| UTV2-770 | Hetzner self-hosted cutover gate | — | — | superseded | MEDIUM — gate conditions defined but freshness proof not produced |
| UTV2-981 | [M1] Restore current live runtime health baseline | M1 | T2 | sandbox/static proof only | HIGH — captured from Windows sandbox (C:\Dev\...); all supervisors DOWN at capture |
| UTV2-982 | [M1] Eliminate unsupported pending outbox targets | M1 | T1 | mechanism implemented | LOW — code fix + unit tests; SHA-bound |
| UTV2-983 | [M1] Collapse runtime health reports | M1 | T2 | mechanism implemented | LOW — tooling unified |
| UTV2-984 | [M1] Fix CLV coverage metric contradiction | M1 | T2 | mechanism implemented | LOW — metric sources reconciled |
| UTV2-985 | [M2] Fix domainAnalysis-to-promotion real-edge wiring | M2 | T1 | final acceptance proven | LOW — live-DB T1 proof: 5/5 tests, pnpm test:db green, SHA-bound |
| UTV2-986 | [M2] Fix Kelly sizing metadata path | M2 | T1 | final acceptance proven | LOW — live-DB T1 proof: 7/7 tests, SHA-bound |
| UTV2-987 | [M2] Replace hardcoded uniqueness score | M2 | T1 | mechanism implemented | MEDIUM — code change + unit tests; no live-DB proof of band-sliced uniqueness in production data |
| UTV2-988 | [M2] Persist promotion band assignment | M2 | T1 | mechanism implemented | MEDIUM — code fix + T1 tests; SHA-bound; 1000+ historical picks still have null bands; band-sliced proof remains INSUFFICIENT_DATA |
| UTV2-989 | [M3] Make deploy readiness gate pass in production mode | M3 | T2 | mechanism implemented | MEDIUM — gate passes in CI; live Hetzner deployment not proven separately |
| UTV2-990 | [M3] Replace GHA-only ingestor with persistent supervisor | M3 | T2 | mechanism implemented | MEDIUM — supervisor scripts shipped; no live-Hetzner uptime proof |
| UTV2-991 | [M3] Add post-deploy functional smoke beyond /health | M3 | T2 | mechanism implemented | MEDIUM — smoke script shipped; not confirmed run against live Hetzner host |
| UTV2-992 | [M3] Prove deploy rollback path | M3 | T2 | sandbox/static proof only | HIGH — explicitly: "no live network calls to Hetzner"; spawn EPERM blocked tsx; rollback path unproven on real host |
| UTV2-993 | [M4] Prove worker restart and double-delivery safety | M4 | T1 | final acceptance proven | LOW — live-DB T1 proof: 3 live-DB + 2 unit tests; SHA-bound (39e9db00) |
| UTV2-994 | [M4] Prove ingestor outage and recovery behavior | M4 | T2 | stale/needs re-proof | HIGH — no proof directory; manifest done/SHA-bound but zero evidence artifact |
| UTV2-995 | [M4] Audit and prove production outbox claim path is atomic | M4 | T1 | final acceptance proven | LOW — atomic SELECT FOR UPDATE proven; SHA-bound (7368a703) |
| UTV2-996 | [M4] Run settlement corruption, correction, and replay drill | M4 | T1 | final acceptance proven | LOW — 5/5 assertions pass against live Supabase; SHA-bound (b959bcaf) |
| UTV2-997 | [M5] Build canonical model evaluation dataset | M5 | T2 | mechanism implemented | MEDIUM — export script + schema shipped; only 5 real-edge rows in 395-pick settled sample |
| UTV2-998 | [M5] Restore measurable ROI with stake units end-to-end | M5 | T1 | mechanism implemented | MEDIUM — stake_units path fixed; no post-fix ROI measurement with real-edge sample |
| UTV2-999 | [M5] Define elite model acceptance thresholds | M5 | T2 | mechanism implemented | LOW — thresholds defined in docs; not yet exercised against passing data |
| UTV2-1000 | [M5] Run post-fix model edge proof | M5 | T2 | stale/needs re-proof | CRITICAL — verdict INSUFFICIENT_DATA; 5 real-edge picks vs 50 minimum; no edge claim valid |
| UTV2-1001 | [M6] Enforce non-null merge SHA at lane close | M6 | T2 | mechanism implemented | LOW — enforcement script shipped; SHA-bound |
| UTV2-1002 | [M6] Reconcile null-SHA and orphaned manifests | M6 | T2 | mechanism implemented | LOW — reconciliation done; SHA-bound |
| UTV2-1003 | [M6] Make ops:reconcile dry-run by default | M6 | T3 | mechanism implemented | LOW |
| UTV2-1004 | [M6] Decide agent system rationalization | M6 | DOCS | mechanism implemented | LOW — decision ratified; follow-up actions tracked in UTV2-1005/1006 |
| UTV2-1005 | [M6] Make runtime-verifier a mandatory readiness gate | M6 | T2 | mechanism implemented | LOW — CI enforcement shipped |
| UTV2-1006 | [M6] Make proof-auditor a mandatory proof gate | M6 | T2 | mechanism implemented | LOW — CI enforcement shipped |
| UTV2-1007 | [M6] Add machine-readable outputs for governance agents | M6 | T2 | mechanism implemented | LOW — executor-result schema defined; agents updated |
| UTV2-1012 | [M3] Deploy Unit Talk services to Hetzner CCX23 | M3 | T2 | mechanism implemented | HIGH — proof is tooling (scripts + GHA), not a live-host run result; no supervisor-status.json artifact exists |
| UTV2-1031 | Live rollback drill (UTV2-992 was sandbox-only) | M3 | T2 | mechanism implemented | HIGH — drill script + workflow shipped; no evidence drill was executed; no rollback-drill-result.json |
| UTV2-1068 | Make lane-close idempotent and self-locking | M6 | T2 | mechanism implemented | LOW — no separate manifest; SHA inferred from commit history |

---

## Classification Summary

| Classification | Count | Notes |
|----------------|-------|-------|
| final acceptance proven | 5 | UTV2-985, UTV2-986, UTV2-993, UTV2-995, UTV2-996 |
| mechanism implemented | 33 | Tooling, governance, scoring fixes with unit/static proof |
| sandbox/static proof only | 2 | UTV2-981, UTV2-992 |
| stale/needs re-proof | 2 | UTV2-994, UTV2-1000 |
| superseded | 1 | UTV2-770 |

---

## Risk Register — Risky Done Issues Requiring Follow-Up

### CRITICAL risk

**UTV2-1000 — Post-fix model edge proof**
- Verdict: explicitly `INSUFFICIENT_DATA`
- Real-edge-backed settled picks: 5 (minimum required: 50)
- Confidence-proxy dominance: 388/395 settled picks (98%)
- **Cannot support:** any model edge, ROI, syndicate-readiness, or winning-performance claim
- **Can support:** proof pipeline is built and will produce a valid verdict once real-edge sample accumulates
- **Follow-up required:** M8 accumulation — time-bound, cannot be shortcut by code completion

### HIGH risk

**UTV2-981 — Runtime health baseline**
- Evidence captured from Windows sandbox (C:\Dev\...), not from Hetzner
- All supervisors DOWN at capture time
- **Cannot support:** claim that services were running on production infrastructure
- **Can support:** health tooling correctly exits non-zero when services are down

**UTV2-992 — Deploy rollback path proof**
- Explicitly documented: "no live network calls to Hetzner", spawn EPERM blocked tsx
- **Cannot support:** rollback works on real Hetzner host
- **Can support:** rollback script logic is correct per static code inspection
- **Follow-up:** UTV2-1031 was opened to re-prove on live host

**UTV2-1012 — Deploy Unit Talk services to Hetzner CCX23**
- Proof artifacts are tooling definitions (scripts + GHA workflow)
- No supervisor-status.json artifact showing containers actually running exists in this repo
- **Cannot support:** services are deployed and running on Hetzner
- **Can support:** verification infrastructure exists to confirm when triggered

**UTV2-1031 — Live rollback drill**
- Drill script and GHA workflow shipped; no rollback-drill-result.json artifact present
- **Cannot support:** rollback from a real failure on production host has been demonstrated
- **Can support:** the drill procedure is automated and ready to run

**UTV2-994 — Ingestor outage and recovery**
- No proof directory exists; zero evidence artifact
- Lane manifest shows done/SHA-bound but proof was never produced
- **Cannot support:** ingestor recovery behavior is proven
- **Follow-up required:** proof run needed against real ingestor

### MEDIUM risk

**UTV2-987, UTV2-988** — Scoring fix mechanisms complete; band-sliced proof blocked by INSUFFICIENT_DATA in settled sample
**UTV2-989, UTV2-990, UTV2-991** — M3 infrastructure tooling shipped; no confirmed live-host execution artifacts in repo
**UTV2-997, UTV2-998** — Dataset and ROI path built; no post-fix real-edge sample of sufficient size

---

## Milestone Truth Status

| Milestone | Linear Progress | Actual Truth | Verdict |
|-----------|----------------|--------------|---------|
| M0 Board Truth Reset | 67% | This issue (UTV2-1035) is the M0 deliverable | IN PROGRESS |
| M1 Runtime Recovery | 89% | Tooling fixed; UTV2-981 from sandbox; live Hetzner runtime unconfirmed | INCOMPLETE |
| M2 Scoring Integrity | 100% | Critical path T1 proof done (UTV2-985/986); band-sliced proof insufficient | PARTIAL — mechanism complete, runtime effect unquantifiable |
| M3 Production Infrastructure | 100% | Scripts/workflows shipped; no confirmed live-host execution artifacts | INCOMPLETE — tooling exists, runtime evidence missing |
| M4 Survivability Drills | 100% | UTV2-993/995/996 live-DB proven; UTV2-992 sandbox-only; UTV2-994 no proof | PARTIAL |
| M5 Model Edge Proof | 100% | Tooling complete; verdict is INSUFFICIENT_DATA | BLOCKED — sample too small |
| M6 Governance Convergence | 93% | Mechanisms shipped; enforcement active in CI | SUBSTANTIALLY COMPLETE |
| M7 72h Production Burn-In | 100% (zero issues assigned) | NOT RUN — burn-in has never occurred | NOT STARTED |
| M8 Syndicate Edge Accumulation | 40% | 5 real-edge picks vs 50+ minimum; time-bound | BLOCKED — time-gated |

---

## What Done Issues CAN Support

The work done in this project is real and substantive. These claims ARE supported by evidence:

1. **Promotion scoring is fail-closed on edge provenance** — confidence-delta no longer masquerades as market-backed edge (UTV2-985/986, T1 live-DB proven)
2. **Worker delivery is atomic and double-delivery safe** — SELECT FOR UPDATE + receipt idempotency key proven (UTV2-993, T1 live-DB proven)
3. **Outbox claim path is atomic** — non-atomic fallback path is blocked in production mode (UTV2-995, T1 proven)
4. **Settlement correction chain is additive and audited** — 396 settled records verified (UTV2-996, live-DB proven)
5. **Health tooling correctly reports NOT READY when services are down** — all health scripts exit non-zero with accurate state (UTV2-981/983/984)
6. **Governance rails are enforced in CI** — SHA binding, proof gates, lane lifecycle enforcement active (UTV2-1001/1005/1006)
7. **Rollback automation is wired** — rollback script logic is correct per static inspection (UTV2-992 — on-host proof still needed)

What cannot be claimed: that the system is deployed, running, healthy, surviving in production, or generating edge-proven picks at any statistically valid sample size.

---

*Generated by UTV2-1035 board truth reset. Merge SHA to be bound at PR merge.*
