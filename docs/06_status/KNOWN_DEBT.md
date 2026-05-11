# Known Debt Dashboard

> Canonical, ticket-linked surface for pre-existing technical debt in Unit Talk V2. Every row is either linked to a Linear issue or explicitly justified with a reason no issue exists yet. This is visibility and closure-pressure infrastructure — not a second hidden backlog.

## Metadata

| Field | Value |
|---|---|
| Authority tier | Tier 5 — Current Status (operational record) |
| Owner | Program Owner |
| Adopted | 2026-04-11 under UTV2-531 |
| Convention change requires | PM approval (append-only for content; convention section is tier-C per `DELEGATION_POLICY.md`) |

## Purpose

Unit Talk V2 already has multiple debt-tracking surfaces scattered across the repo:

- `docs/05_operations/docs_authority_map.md` → "Schema Debt Register" (schema-layer debt)
- `docs/05_operations/risk_register.md` → open program risks
- `.claude/agent-brief.md` → orchestrator-facing known gotchas
- individual `CLAUDE.md` files in `apps/*` and `packages/*` → app-local known issues
- scattered `TODO` / `FIXME` markers in source code

This dashboard does **not** replace those surfaces. It is a **pointer index** that catalogs every currently acknowledged debt item in one place with an explicit Linear link (or an explicit justification for why no issue exists yet). When a reader wants "what do we owe?", this is the one page to open.

## Scope — what belongs here

A debt entry belongs in this dashboard when **all** of the following are true:

1. It represents a real outstanding condition in the repo, runtime, or data — not a speculative improvement or a wishlist item.
2. It was acknowledged in at least one of: a Linear issue, a CLAUDE.md, an authority-map register, a risk register, an incident entry, or a code comment.
3. Either:
   - (a) it already has a Linear issue, **or**
   - (b) the reason no Linear issue exists yet is documented on the row.
4. It is not purely an anti-drift rule (anti-drift rules belong in `CLAUDE.md`, not here — this dashboard tracks *unfixed conditions*, not discipline rules).

A debt entry does **not** belong here when:

- It is a vague "we should refactor X someday" without an observed failure class
- It is fully resolved (move the row to the closed section below instead of deleting)
- It is a feature request or capability wishlist — that belongs in Linear directly
- It duplicates an entry already here (one canonical row per debt — if sources split the same debt, merge them)

## Entry format

Each open debt row uses the following columns, in this order:

| Column | Meaning |
|---|---|
| **ID** | Stable slug for cross-reference, format `DEBT-NNN` (zero-padded, assigned at insertion, never reused) |
| **Area** | `schema` / `runtime` / `test-coverage` / `data-state` / `cross-app` / `operational` / `routing` |
| **Title** | One-line description of the debt condition |
| **Impact** | `High` / `Medium` / `Low` — how much this hurts if left unfixed |
| **Linear** | Linear issue ID if one exists, or `none — <reason>` |
| **Evidence** | Source path(s) where the debt is already acknowledged |
| **Status** | `open` / `partial` / `blocked` / `closed` (closed rows move to the archive section) |

The goal is every row being actionable: the ID gives it a handle, the Linear link gives it closure pressure, and the evidence line lets a reader verify that the debt actually exists.

## Conventions

### Adding a new debt entry

1. **Confirm a real source exists.** Before adding a row, verify the debt is already acknowledged in at least one of the sources listed in the Scope section. Do not add a row for a debt that has no existing reference — if it is genuinely new, write the reference first (a CLAUDE.md note, a code comment, or a Linear issue), then add the dashboard row that points to it.
2. **Prefer a real Linear issue.** If no issue exists but the debt is actionable, open one and link it. Use `none — <reason>` only when:
   - the debt is blocked on an upstream decision not yet made
   - the debt is captured in a non-Linear authority surface (e.g. risk register row) and a Linear issue would duplicate it
   - the debt is a structural pattern (e.g. "InMemory-vs-Postgres drift") rather than a single fix
3. **Assign the next `DEBT-NNN`.** IDs are monotonic and never reused. Check the current max ID in the table below and increment.
4. **Keep the row short.** The dashboard is a pointer. Long explanations belong in the linked issue or evidence file.
5. **Update PROGRAM_STATUS.md** if the debt materially changes risk posture or milestone gating. Otherwise do not.

### Removing / closing a debt entry

1. **Never delete a row.** Move it from the open table to the **Closed Debt (audit trail)** section at the bottom with the resolution date, closing PR, and a one-line resolution note.
2. **Closure trigger.** A row is eligible for the closed section only when:
   - the linked Linear issue is Done AND
   - the underlying condition is verifiably resolved (PR merged, runtime verified, or data state cleaned)
3. **Partial resolutions stay open** with status `partial` and a note on what portion closed.

### Code TODO / debt marker convention

Every TODO, FIXME, HACK, XXX, or similar debt marker added to `apps/**`, `packages/**`, or `scripts/**` source code **must** reference a Linear issue in the form `TODO(UTV2-NNN): ...` or `FIXME(UTV2-NNN): ...`. Markers without a ticket reference are not allowed for new code.

Rules:

- **New markers require a ticket.** If you are writing a TODO in a PR, open (or find) the Linear issue first and include its ID. A TODO without a ticket is grounds for PR rejection.
- **Existing unlinked markers are grandfathered** until they are touched. When a PR modifies a file containing an unlinked marker, the marker must be upgraded to include a ticket reference or removed.
- **Generic "regenerate via pnpm supabase:types" markers** (already present in `packages/db/src/types.ts` and `packages/db/src/market-universe-repository.ts`) are exempt — they are regeneration instructions, not debt.
- **Removing a marker** requires either (a) the underlying condition is resolved, or (b) an explicit decision that the condition is no longer debt. In case (b), the decision is logged in the closing PR description.

A lint rule enforcing this convention is not yet in place. Adding one is itself tracked as `DEBT-011` below.

## Open Debt

As of 2026-04-11 (UTV2-531 initial backfill). Sorted by impact, then area.

| ID | Area | Title | Impact | Linear | Evidence | Status |
|---|---|---|---|---|---|---|
| DEBT-001 | schema | Dual participant system: `participants` + `participant_memberships` (old) coexists with `leagues`/`teams`/`players`/`player_team_assignments` (new); `picks.participant_id` still FKs to the old system | High | UTV2-398 | `docs/05_operations/docs_authority_map.md` Schema Debt Register | open |
| DEBT-003 | runtime | `system-pick-scanner` re-enabled 2026-04-24 per PM decision (PR #455, UTV2-587). `SYSTEM_PICK_SCANNER_ENABLED=true` in local.env. Board-construction picks now flowing through pipeline. CLV join confirmed working (3/7 picks with full closing data, deltas +52/+125/+243). Remaining gap: `runBoardPickWriter` not scheduled — see UTV2-749. | High | UTV2-519 (merged), UTV2-587 (Done), UTV2-749 (open) | `docs/06_status/proof/UTV2-587/evidence.json`; UTV2-589 CLV evidence | resolved (UTV2-749 tracks scheduling gap) |
| DEBT-004 | test-coverage | InMemory repositories do not enforce Postgres CHECK constraints, producing a systemic test-vs-runtime gap. UTV2-519 was the visible failure mode; the pattern is broader and applies to every lifecycle/approval control with a CHECK-constrained target state | High | none — structural pattern, not a single fix; a per-control `pnpm test:db` gate is the mitigation and is being added per control as each is proven | `packages/db/CLAUDE.md`; UTV2-519 incident entry §Policy/Control Failure | partial — InMemory constraint guards added for status enum + submission_events + settlement_records in UTV2-881 (PR #625); structural gap remains for constraints not yet enumerated |
| DEBT-005 | cross-app | `apps/alert-agent/src/main.ts` imports directly from `apps/api/src/server.js` and `apps/api/src/alert-agent.js`, violating the no-cross-app-imports invariant. Alert detection logic should migrate to `@unit-talk/domain` or a shared service package | Medium | UTV2-540 | `docs/05_operations/docs_authority_map.md` Schema Debt Register row; `apps/alert-agent/CLAUDE.md` | closed |
| DEBT-006 | routing | `discord:game-threads` routing architecture not implemented. Worker posts to channel IDs only; thread-routing delivery path does not exist | Medium | none — deferred per risk register R-09 | `docs/05_operations/risk_register.md` R-09; `CLAUDE.md` Live Discord Targets table | open (deferred) |
| DEBT-007 | routing | `discord:strategy-room` DM routing architecture not implemented. No DM delivery contract or receipt handling exists | Medium | none — deferred per risk register R-10 | `docs/05_operations/risk_register.md` R-10; `CLAUDE.md` Live Discord Targets table | open (deferred) |
| DEBT-008 | schema | Promotion score components (`edge_score`, `trust_score`, `readiness_score`, `uniqueness_score`, `boardFit_score`) live inside `pick_promotion_history.payload` JSON — not as top-level columns. Queries that assume top-level columns fail. Additionally: per-component breakdown never stored (`payload.breakdown` null for all rows), and `qualified`/`score` not at payload top level — blocks `ops:truth-check` promotion queries. Extension tracked in UTV2-904. | Medium | UTV2-541, UTV2-904 | `docs/05_operations/CC_INTELLIGENCE_METRICS_REGISTER.md`; `docs/06_status/proof/PROMOTION_SCORE_AUDIT_20260511.md` | partial — UTV2-904 (PR #626) resolved breakdown/qualified/score persistence for all 7 call sites; top-level column promotion (UTV2-541) still open |
| DEBT-009 | runtime | Worker circuit breaker state is in-memory only. State resets on worker restart, allowing a burst of traffic to a downed target immediately after restart | Low | none — acknowledged in worker CLAUDE.md; persistence layer would be a T2 capability change | `apps/worker/CLAUDE.md` | open |
| DEBT-010 | runtime | `claimNext()` in `apps/worker` performs non-atomic SELECT-then-UPDATE for outbox row claims. The window between the two operations is small but non-zero. No observed incident; UTV2-441 (merged) addressed adjacent transient-network crash class | Low | none — no observed incident; open one if the race is ever reproduced | `apps/worker/CLAUDE.md` | open |
| DEBT-011 | operational | No lint rule yet enforcing the "TODO must reference UTV2-NNN" convention defined in this dashboard. Currently enforced by convention and review only | Low | none — open when the convention has been in place for one merge cycle and is ready to mechanize | this file, `## Code TODO / debt marker convention` section | open |

| DEBT-013 | cross-app | Smart-form UI only supports 5 market types (player-prop, moneyline, spread, total, team-total). Period/half/quarter/inning market types added to catalog in UTV2-700 (2026-04-20) are NOT accessible from smart-form — `form-schema.ts` MARKET_TYPE_IDS must be extended and offer-loading validated per period market. No false completion claims found in git history. | Medium | UTV2-882 | `apps/smart-form/lib/form-schema.ts` MARKET_TYPE_IDS; UTV2-700 (#398); UTV2-699 audit 2026-04-21 | closed — period markets wired in UTV2-882 PR #624 at SHA a4172df5 |
| DEBT-014 | type-safety | Pre-existing type errors in `packages/verification/src/shadow-pipeline-runner.ts` and `divergence-classifier.ts`; `shadow-runner.ts` has `exactOptionalPropertyTypes` violations on `from`/`to` date fields. Not blocking CI (errors are in non-built paths). | Medium | none — no Linear issue yet; open one when verification package is next touched | `packages/verification/CLAUDE.md` Known Drift | open |
| DEBT-015 | test-coverage | `packages/verification` has low test coverage relative to its complexity. Shadow pipeline, divergence classifier, and fault injection engine have minimal assertions. | Low | none — no Linear issue yet | `packages/verification/CLAUDE.md` Known Drift | open |
| DEBT-016 | contracts | `packages/contracts/src/picks.ts` imports from `./index.js` (re-export cycle). Safe for type-only imports but fragile if runtime values are ever added to that barrel export. | Low | none — no incident; open if values are added | `packages/contracts/CLAUDE.md` Known Drift | open |
| DEBT-017 | schema | `promotion_target_check` Postgres constraint must be kept in sync with `promotionTargets` array in `packages/contracts/src/picks.ts` manually. No lint or migration check enforces this. | Medium | none — no Linear issue yet; open when contracts are next extended | `packages/contracts/CLAUDE.md` Known Drift | open |

| DEBT-018 | data-state | Band assignment (A+/A/B/C/SUPPRESS) computed at promotion evaluation time but never persisted to `picks.metadata` or `pick_promotion_history`. All 395 settled picks in 30-day audit window have `picks.metadata->>'band' = null`. Blocks band-sliced CLV/ROI analysis (UTV2-892) and model edge ratification (UTV2-896). | High | UTV2-906 | `docs/06_status/proof/PROMOTION_SCORE_AUDIT_20260511.md` §Structural Gaps; `apps/api/src/promotion-service.ts` | open |
| DEBT-019 | runtime | `pick.metadata.domainAnalysis` not populated for 92%+ of picks. `readDomainAnalysisEdgeScore()` and `readDomainAnalysisTrustSignal()` fall back to `confidenceScore` for 92.4% of picks (audit: 9,949/12,043 confidence-delta). Both edge (35%) and trust (25%) inputs degraded — combined 60% of the promotion score is a confidence proxy. | High | UTV2-903 | `docs/06_status/proof/PROMOTION_SCORE_AUDIT_20260511.md` §1 Edge, §2 Trust | open |
| DEBT-020 | runtime | `pick.metadata.kellySizing` not populated before promotion evaluation. `readKellyGradientReadiness()` returns null 94.4% of the time. 20% of promotion score is constant fallback (60). Kelly computation exists in `packages/domain/src/risk/` but result not wired to pick metadata. | High | UTV2-901 | `docs/06_status/proof/PROMOTION_SCORE_AUDIT_20260511.md` §3 Readiness | open |
| DEBT-021 | runtime | `computeBoardFitScore()` returns value of 10 for 74.9% of picks — not the 75 fallback but the computed output. Root cause unknown (concentration penalty maxed, self-exclusion bug, or stale board state). 10% of promotion score is near-floor for three-quarters of picks. | High | UTV2-902 | `docs/06_status/proof/PROMOTION_SCORE_AUDIT_20260511.md` §5 BoardFit | open |

Current max ID: `DEBT-021`. Next insertion uses `DEBT-022`.

## Closed Debt (audit trail)

Rows move here when resolved. Never deleted. Sorted newest-first.

| ID | Title | Closed | Linear | Resolution |
|---|---|---|---|---|
| ID | Title | Closed | Linear | Closing PR | Resolution note |
|---|---|---|---|---|---|
| DEBT-013 | Smart-form period market types missing | 2026-05-11 | UTV2-882 | PR #624 (SHA a4172df5) | Period/half/quarter/inning market types wired into `apps/smart-form/lib/form-schema.ts` MARKET_TYPE_IDS. Validated 2026-05-11. |
| DEBT-005 | cross-app alert-agent imports from apps/api | 2026-05-11 | UTV2-540, UTV2-880 | n/a (already resolved in codebase) | `apps/alert-agent/src/main.ts` now imports only from `@unit-talk/alert-runtime`, `@unit-talk/config`, and `@unit-talk/db`. Alert detection logic was extracted to `@unit-talk/alert-runtime` package. Verified 2026-05-11 — no cross-app imports present. |
| DEBT-012 | Stale lane manifests (UTV2-575/580/622/624/625) | 2026-05-11 | UTV2-585, UTV2-888 | PRs #309–313 (merged 2026-04-15) | All 5 lanes confirmed done: lane JSON status=done, merge SHAs recorded in manifests. Verified 2026-05-11; UTV2-888 closed Done. **PM policy (2026-05-11):** stale manifests are archived (not deleted); proof-lineage is preserved; milestone-audit artifacts supersede individual lane manifests for historical record. |
| DEBT-002 | Stranded awaiting_approval picks (1,047 rows) | 2026-05-11 | UTV2-539, UTV2-887 | Direct SQL void (PM-approved) | 1,047 picks (not 24 — DEBT-002 predated scanner re-enable 2026-04-26) all voided via `UPDATE picks SET status='voided', stake_units=1 WHERE status='awaiting_approval'`. Constraint workaround: picks had null stake_units grandfathered by NOT VALID flag; set to 1 alongside void. 0 remaining. UTV2-887 closed Done. **PM policy (2026-05-11):** expire-by-default for stranded picks; no mass approval; audit trail preserved; UTV2-863/864 runtime truth protected. |

## Cross-references

- `docs/05_operations/docs_authority_map.md` — authority map; this dashboard is registered under Tier 5
- `docs/05_operations/docs_authority_map.md#schema-debt-register` — the authoritative schema debt register (DEBT-001, DEBT-005 mirror entries there)
- `docs/05_operations/risk_register.md` — program risks (DEBT-006, DEBT-007 reference R-09, R-10)
- `docs/06_status/INCIDENTS/` — incident log (DEBT-002, DEBT-003, DEBT-004 reference INC-2026-04-10-utv2-519)
- `docs/05_operations/DELEGATION_POLICY.md` — sensitive-path rules that govern DEBT-002 cleanup authority
- `CLAUDE.md` — runtime anti-drift rules; intentionally separate from this debt list

## Review cadence

- **On every merge to main that touches a listed debt source surface**, the committing agent must check whether any row here should transition to `partial` or `closed`.
- **On every new incident entry** under `docs/06_status/INCIDENTS/`, check whether new debt rows should be opened to capture the incident's post-remediation follow-ups.
- **Quarterly retro** — full sweep: verify every open row still has an evidence file that exists, every Linear link still resolves, and no row has drifted into "wishlist" territory.
