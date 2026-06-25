# Canonical Gap Map — Dedup Recommendations

**Generated:** 2026-06-25  
**Lane:** UTV2-1310 (G-CONST-15)  
**Scope:** All open (non-Done, non-Cancelled) Linear issues as of 2026-06-25

---

## Open Issue Count by State

| State | Type | Count |
|---|---|---|
| Ready for Claude | unstarted | 5 |
| Backlog | backlog | 15 |
| Needs Standard | backlog | 2 |
| Blocked Internal | started | 4 |
| future-stage-gated | backlog | 8 |
| **Total open** | | **27** (excl. Done/Deferred/Cancelled) |

Note: The `future-stage-gated` issues (9 issues including 7 INIT-5.x capital runtime issues) are intentionally frozen — they should NOT be dispatched until upstream programs are certified.

---

## G-CONST Gaps Still Open

The G-CONST series tracks constitutional governance gaps. Status as of 2026-06-25:

| G-CONST # | Issue | Status | Notes |
|---|---|---|---|
| G-CONST-9 | UTV2-1307 | Done | Refresh CURRENT_STATE.md |
| G-CONST-11 | UTV2-1306 | Done | Retention Execution Preflight |
| G-CONST-12 | UTV2-1308 | Done | Tripwire monitor parity |
| G-CONST-13 | UTV2-1305 | Done | Deploy SHA Alignment |
| **G-CONST-14** | **UTV2-1309** | **Ready for Claude** | Readiness Score Ledger — dispatch next |
| **G-CONST-15** | **UTV2-1310** | **In Claude** | This lane — Canonical Gap Map |
| **G-CONST-16** | **UTV2-1311** | **Ready for Claude** | Prod SHA deploy follow-through |
| **G-CONST-17** | **UTV2-1312** | **Ready for Claude** | Outbox classification audit |

G-CONST-10 is absent from search results — likely Done or Cancelled under a different title. No gap in numbering severity; G-CONST-11 through G-CONST-17 form a continuous series.

**4 open G-CONST gaps** (14, 15, 16, 17). All are T2, Ready for Claude. All are safe to dispatch in parallel (different file scopes).

---

## Duplicate / Overlap Analysis

### Near-Duplicate Groups (PM review recommended)

#### Group 1: Constitution Readiness Audit v3 (BOTH DONE — informational only)
- **UTV2-1301** — Constitution Gap Audit v3 — post-ingestion incident production-readiness (Done)
- **UTV2-1302** — Production Readiness Audit v3 — post-ingestion recovery launch blocker (Done)

Both are Done. They were created in parallel during the same incident response and both represent the v3 readiness audit. No action needed, but **avoid creating a v4 audit as two separate issues** — one canonical issue per audit cycle.

#### Group 2: Edge Certification + Dependent Monitors (active overlap)
- **UTV2-1042** — Syndicate-ready edge certification (Blocked Internal, Urgent)
- **UTV2-1033** — STRONG label proof run — trigger after 200+ settled picks (Blocked Internal)
- **UTV2-1250** — Monitor settled CLV-path sample for UTV2-1042 re-evaluation (Blocked Internal)

These are **not duplicates** but form a hard dependency chain. All three block on the same data-gated condition (real-money CLV-backed picks accumulation). **Do not dispatch any of these until the underlying data gate is satisfied.** UTV2-1250 is the active monitor.

#### Group 3: SGO Identity / Closing Odds Waves (sequential, not concurrent)
- **UTV2-1268** — Capture SGO native closeBookOdds/closeFairOdds (Backlog, T1)
- **UTV2-1277** — Canonical SGO identity schema (Wave 3) (Backlog, T1)

These are sequential SGO waves. UTV2-1277 (schema change) should land before UTV2-1268 (usage of those fields). **Dispatch UTV2-1277 first.**

#### Group 4: CLV Resolution Extension (sequential, not concurrent)
- **UTV2-1264** — Extend CLV resolution to game totals (Backlog, T1, Priority High)
- **UTV2-1265** — Extend CLV resolution to spread bets (Backlog, T1, Priority Medium)

Independent market types but same resolver infrastructure. **Dispatch UTV2-1264 first** (1,833 affected rows vs. spread bets). Avoid concurrent dispatch — both touch the CLV resolver.

---

## Recommended Cancel / Merge Actions (PM review — no mutations executed)

| Action | Issue(s) | Reason |
|---|---|---|
| No action | UTV2-1033, UTV2-1250 | Data-gated monitors; leave open pending accumulation |
| No action | UTV2-1176 | PM freeze active — do not touch |
| No action | INIT-5.x (UTV2-1144–1146, 1152–1154) | Future-stage-gated; open intentionally |
| Consider closing | UTV2-433 (MP-M3: MLB live gate) | 18 days stale, blocked since CLV coverage was 3/167. If CLV coverage has since improved past 10, re-evaluate and close or move to Ready. |
| Consider spec | UTV2-884, UTV2-885 | Both in "Needs Standard" for 16 days. Need a brief standard spec to unblock. High-value USPs (member DMs, game threads). |

---

## Top Dispatch Candidates

Ranked by impact x readiness:

| Priority | Issue | Tier | State | Executor | Why |
|---|---|---|---|---|---|
| 1 | **UTV2-1312** G-CONST-17 Outbox audit | T2 | Ready for Claude | Claude | 558 pending rows, 442 dead_letter — operational health risk |
| 2 | **UTV2-1311** G-CONST-16 Prod deploy | T2 | Ready for Claude | Claude | Prod 7 commits behind main — easy alignment win |
| 3 | **UTV2-1309** G-CONST-14 Readiness Ledger | T2 | Ready for Claude | Claude | Enables automated dispatch loop quality signal |
| 4 | **UTV2-1264** CLV game totals extension | T1 | Backlog | Claude/Codex | 1,833 rows with missing_event_context — high CLV coverage impact |
| 5 | **UTV2-1271** SGO outlier foundation | T1 | Ready for Claude | Claude | Architecture/requirements only — low-risk planning lane |
| 6 | **UTV2-1277** SGO identity schema Wave 3 | T1 | Backlog | Claude/Codex | Must land before UTV2-1268 (closing odds capture) |

---

## Notes

- This map was generated from a read-only Linear scan. No issues were mutated.
- The "open" count of 27 excludes Done, Deferred, Cancelled, and the large body of historical Done issues returned in the G-CONST search.
- Future-stage-gated issues (INIT-5.x) are valid open issues intentionally held behind Program 5 preconditions; they are not noise.
- G-CONST-10 was not found in search results — likely Done under a different naming scheme or cancelled. Not a concern.
