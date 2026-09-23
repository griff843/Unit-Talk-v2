# Command Center Operations IA — Simplification Proposal

**Status:** Ratified 2026-04-14 (UTV2-567)
**Authority:** Canonical navigation and route structure for operator-web. **[ARCHIVED — operator-web decommissioned 2026-04-27]**
**Blocked by:** UTV2-565 (queue legibility), UTV2-566 (detail hero) — both merged.

---

## Problem

The current CC has 23 routes organized by implementation convenience, not operator workflow. Operators face overlapping destinations (review-queue vs held-queue vs pick-search), unclear naming (intelligence vs performance vs stats), and no canonical triage-to-action flow.

---

## Current Route Inventory (23 routes, 6 clusters)

| Cluster | Routes | Overlap Problem |
|---|---|---|
| **Pick Queues** | review-queue, held-queue, pick-search | Three entry points for "which picks need attention?" |
| **Performance** | performance, intelligence, intelligence-coverage, stats, leaderboard | Five routes computing overlapping stats from the same dataset |
| **Recaps** | capper-recap (+ stats overlap) | Unclear distinction from performance |
| **Exceptions** | exception-queues (8 sub-queues) | Single monolith with 8 distinct concerns |
| **Board** | board-state, board-queue, board/performance | Three routes, inconsistent path prefix |
| **System** | snapshot, provider-health, health, picks-pipeline | Monitoring/diagnostics mixed with operator surfaces |

---

## Proposed IA (5 primary sections)

### 1. Triage (operator starts here)

**Purpose:** "What needs my attention right now?"

| Route | Action | Current Route |
|---|---|---|
| `GET /api/operator/triage/review` | Picks awaiting approval or pending review | review-queue |
| `GET /api/operator/triage/held` | Picks on hold awaiting re-review | held-queue |
| `GET /api/operator/triage/exceptions` | Operational exceptions requiring intervention | exception-queues |

**Recommendation:** Keep review and held as separate views (different operator intent: "new work" vs "deferred work"). The exception-queues monolith should be **split** into typed sub-routes in a future implementation lane:

| Sub-queue | Proposed Route | Operator Action |
|---|---|---|
| Failed deliveries | `triage/exceptions/delivery` | Retry or escalate |
| Dead letters | `triage/exceptions/dead-letter` | Manual intervention |
| Stale validated | `triage/exceptions/stale` | Rerun or void |
| Approval drift | `triage/exceptions/drift` | Review or escalate |
| Rerun candidates | `triage/exceptions/rerun` | Approve rerun |
| Missing provider aliases | `triage/exceptions/aliases` | Data fix |

For now, the existing monolith endpoint is acceptable with client-side section anchoring.

### 2. Search (operator investigates)

**Purpose:** "Find a specific pick or set of picks."

| Route | Action | Current Route |
|---|---|---|
| `GET /api/operator/picks` | Full-featured pick search with filters | pick-search |
| `GET /api/operator/picks/:id` | Pick detail with full lifecycle | picks/:pickId |

**Recommendation:**
- **Rename** `pick-search` to `picks` (it is the canonical pick list).
- **Remove** the `/api/operator/review-queue` search param overlap. Review queue is a filtered view, not a search engine.
- pick-search already supports `status`, `approval`, `source` filters — review-queue is a preset of these.

### 3. Board (syndicate governance)

**Purpose:** "What is the promotion board doing?"

| Route | Action | Current Route |
|---|---|---|
| `GET /api/operator/board` | Board capacity, scores, conflicts | board-state |
| `GET /api/operator/board/queue` | Latest board run with candidate status | board-queue |
| `GET /api/operator/board/performance` | Governed pick attribution | board/performance |

**Recommendation:**
- **Unify path prefix** to `/api/operator/board/*`.
- **Rename** `board-state` to `board` (it is the primary board view).
- No functional changes needed — these serve distinct concerns.

### 4. Analytics (operator reviews outcomes)

**Purpose:** "How are picks and operators performing?"

| Route | Action | Current Route |
|---|---|---|
| `GET /api/operator/analytics/performance` | Time-windowed stats, decision tracking, source split | performance |
| `GET /api/operator/analytics/intelligence` | Score quality, decision accuracy, feedback loop | intelligence |
| `GET /api/operator/analytics/leaderboard` | Capper/source ranking | leaderboard |
| `GET /api/operator/analytics/review-history` | Past review decisions with outcomes | review-history |

**Recommendation:**
- **Merge** `intelligence-coverage` into `intelligence` (it's a subset of the same dataset).
- **Merge** `stats` into `performance` (overlapping purpose).
- **Merge** `capper-recap` into `leaderboard` (per-capper breakdown belongs with ranking).
- **Unify path prefix** to `/api/operator/analytics/*`.
- Reduces 6 routes to 4.

### 5. System (monitoring, not operator workflow)

**Purpose:** "Is the system healthy?"

| Route | Action | Current Route |
|---|---|---|
| `GET /api/operator/system/snapshot` | Full system state | snapshot |
| `GET /api/operator/system/pipeline` | Pick lifecycle counts | picks-pipeline |
| `GET /api/operator/system/providers` | Market feed health | provider-health |
| `GET /health` | Health check | health |

**Recommendation:**
- **Move** monitoring routes under `/api/operator/system/*`.
- **Remove** `participants` from primary navigation (reference data, not operator workflow).
- These are not part of the operator triage loop.

---

## Route Transition Map

| Current Route | Proposed Route | Action |
|---|---|---|
| `/api/operator/review-queue` | `/api/operator/triage/review` | Rename |
| `/api/operator/held-queue` | `/api/operator/triage/held` | Rename |
| `/api/operator/exception-queues` | `/api/operator/triage/exceptions` | Rename |
| `/api/operator/pick-search` | `/api/operator/picks` | Rename |
| `/api/operator/picks/:pickId` | `/api/operator/picks/:id` | Keep (minor param rename) |
| `/api/operator/board-state` | `/api/operator/board` | Rename |
| `/api/operator/board-queue` | `/api/operator/board/queue` | Rename |
| `/api/board/performance` | `/api/operator/board/performance` | Move under /operator |
| `/api/operator/performance` | `/api/operator/analytics/performance` | Rename |
| `/api/operator/intelligence` | `/api/operator/analytics/intelligence` | Rename |
| `/api/operator/intelligence-coverage` | Merge into `analytics/intelligence` | Remove |
| `/api/operator/leaderboard` | `/api/operator/analytics/leaderboard` | Rename |
| `/api/operator/review-history` | `/api/operator/analytics/review-history` | Rename |
| `/api/operator/stats` | Merge into `analytics/performance` | Remove |
| `/api/operator/capper-recap` | Merge into `analytics/leaderboard` | Remove |
| `/api/operator/snapshot` | `/api/operator/system/snapshot` | Rename |
| `/api/operator/picks-pipeline` | `/api/operator/system/pipeline` | Rename |
| `/api/operator/provider-health` | `/api/operator/system/providers` | Rename |
| `/api/operator/participants` | `/api/operator/system/participants` | Move (reference data) |
| `/health` | `/health` | Keep |
| `/` | `/` | Keep (dashboard) |

**Net result:** 23 routes -> 18 routes (5 merged), organized into 5 clear sections.

---

## Canonical Triage-to-Action Flow

```
1. TRIAGE          What needs attention?
   /triage/review  -> New picks awaiting approval
   /triage/held    -> Deferred picks to revisit
   /triage/exceptions -> System problems

2. ACT             Take action on a pick
   /picks/:id      -> Review, approve, deny, hold, settle

3. SEARCH          Find specific picks
   /picks           -> Filter by status, source, capper, sport, date

4. REVIEW          How did decisions turn out?
   /analytics/*    -> Performance, intelligence, leaderboard, history

5. GOVERN          Board and system health
   /board/*        -> Promotion governance
   /system/*       -> Pipeline, providers, snapshots
```

---

## Implementation Sequence

This proposal is docs-only. Implementation should be phased:

1. **Phase 1 — Path aliases:** Add new route paths as aliases for current routes (backward-compatible). Zero breaking changes.
2. **Phase 2 — Merge overlapping routes:** Fold `stats` into `performance`, `intelligence-coverage` into `intelligence`, `capper-recap` into `leaderboard`. Feature-flag old endpoints.
3. **Phase 3 — Remove old paths:** After frontend migration, remove deprecated route aliases.
4. **Phase 4 — Split exception-queues:** Break monolith into typed sub-routes if operator feedback warrants it.

---

## Related Artifacts

- Pick Identity Contract: `docs/02_architecture/contracts/PICK_IDENTITY_CONTRACT.md`
- Pick Identity Audit: `docs/02_architecture/contracts/PICK_IDENTITY_AUDIT.md`
- Operator-web routes: `apps/operator-web/src/routes/`
- Server registration: `apps/operator-web/src/server.ts`
