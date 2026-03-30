# Unit Talk V2 — Repo Map

> Updated: 2026-03-29 (UTV2-158). All paths are relative to repo root `C:\dev\Unit-Talk-v2`.

---

## Root Layout

```
Unit-Talk-v2/
├── apps/
│   ├── api/                  # Canonical write API
│   ├── worker/               # Distribution outbox worker
│   ├── operator-web/         # Read-only operator dashboard
│   ├── smart-form/           # Browser intake form
│   ├── discord-bot/          # Discord slash commands + event handlers
│   ├── alert-agent/          # Alert detection + notification pass runner
│   └── ingestor/             # External results ingestion (SGO + league data)
├── packages/
│   ├── contracts/            # Types and policy constants (zero deps)
│   ├── domain/               # Pure business logic
│   ├── db/                   # DB types, repositories, lifecycle
│   ├── config/               # Env loading
│   ├── observability/        # Logging/tracing
│   ├── events/               # Event types
│   ├── intelligence/         # AI/analysis utilities
│   └── verification/         # Scenario registry + run history
├── supabase/
│   ├── migrations/           # 8 SQL migration files
│   └── config.toml
├── scripts/
│   └── kill-port.mjs         # Cross-platform port cleanup
├── docs/
│   ├── 02_architecture/
│   ├── 03_product/
│   ├── 05_operations/        # Contracts, guides, sprint model
│   ├── 06_status/            # PROGRAM_STATUS.md, system_snapshot.md
│   ├── ai_context/           # AI handoff docs (this folder)
│   ├── audits/               # Code/policy audits
│   └── discord/              # Discord policy and specs
├── out/                      # Build artifacts (gitignored except /sprints)
├── CLAUDE.md                 # Claude Code instructions
├── AGENTS.md                 # Agent team charter
├── tsconfig.json             # Root TypeScript project references
├── pnpm-workspace.yaml
└── package.json              # Root workspace scripts
```

---

## apps/api — Key Files

```
apps/api/src/
├── server.ts                          # Express server, route wiring
├── submission-service.ts              # processSubmission() — 4 steps
├── promotion-service.ts               # Score resolution + eager policy eval
├── settlement-service.ts              # recordInitialSettlement/Correction/ManualReview
├── distribution-service.ts            # enqueueDistributionWithRunTracking()
├── lifecycle-service.ts               # Re-exports from @unit-talk/db
├── persistence.ts                     # InMemory/Database repos for API app
├── handlers/
│   ├── submit-pick-handler.ts
│   └── settle-pick-handler.ts
├── controllers/
│   ├── submit-pick-controller.ts
│   └── settle-pick-controller.ts
├── promotion-edge-integration.test.ts # Promotion gate integration tests
├── submission-service.test.ts         # Submission flow tests
└── settlement-service.test.ts         # Settlement flow tests
```

**Routes:**
- `POST /api/submissions` → submit pick
- `POST /api/picks/:id/settle` → settle pick
- `GET /health`

---

## apps/worker — Key Files

```
apps/worker/src/
├── distribution-worker.ts   # processNextDistributionWork() — poll/claim/deliver/receipt
├── index.ts                 # Worker process entry, polling loop
└── distribution-worker.test.ts
```

---

## apps/operator-web — Key Files

```
apps/operator-web/src/
├── server.ts                # All routes + createSnapshotFromRows() + HTML rendering
└── server.test.ts           # HTTP + snapshot unit tests
```

**Routes:**
- `GET /` → HTML dashboard
- `GET /health`
- `GET /api/operator/snapshot` (query: `outboxStatus`, `target`, `since`, `lifecycleState`)
- `GET /api/operator/picks-pipeline`
- `GET /api/operator/recap`

---

## apps/smart-form — Key Files

```
apps/smart-form/
├── app/
│   └── submit/
│       └── page.tsx         # Submit page → <BetForm />
├── components/
│   └── BetForm.tsx          # Form component — posts to apps/api
├── lib/
│   └── api-client.ts        # submitPick() — fetch to /api/submissions
└── package.json             # predev hook: node scripts/kill-port.mjs 4100
```

**Hardcoded:** `source = 'smart-form'` (governance rule — user input ignored)
**Body limit:** 65536 bytes (413 on violation)
**Missing:** No `confidence` field in V1 form — all picks score 61.5

---

## apps/alert-agent — Key Files

```
apps/alert-agent/src/
└── main.ts                  # Entry point: runAlertDetectionPass() + runAlertNotificationPass()
```

**Purpose:** Runs alert detection and notification passes. Writes `system_runs` rows per pass (`runType: 'alert.detection'` and `runType: 'alert.notification'`). Operator snapshot `alertAgent` section shows last-run summary.

---

## apps/ingestor — Key Files

```
apps/ingestor/src/
├── index.ts                 # Entry point
├── ingestor-runner.ts       # Top-level orchestration
├── ingest-league.ts         # Per-league ingestion logic
├── entity-resolver.ts       # Resolves participants/teams from external data
├── results-fetcher.ts       # Fetches results from external sources
├── results-resolver.ts      # Maps fetched results to internal schema
├── sgo-fetcher.ts           # SGO (Sports Grading Oracle) API client
├── sgo-normalizer.ts        # Normalizes SGO data to internal types
├── historical-backfill.ts   # Backfill ingestion for historical data
└── ingestor.test.ts         # Ingestor unit tests
```

**Purpose:** Ingests external results data (SGO + league feeds) and writes to the DB. Used to settle picks automatically based on live outcomes.

---

## packages/contracts — Key Files

```
packages/contracts/src/
├── index.ts
├── pick.ts                  # CanonicalPick, PickSource, PickLifecycleState
├── promotion.ts             # PromotionPolicy, PromotionTarget, score weights, policy constants
├── settlement.ts            # SettlementInput, SettlementRecord
└── submission.ts            # SubmissionInput, ValidatedSubmission
```

**Key exports from promotion.ts:**
- `bestBetsPromotionPolicy` — minimumScore:70, confidenceFloor:0.6
- `traderInsightsPromotionPolicy` — minimumScore:80, minimumEdge:85, minimumTrust:85, confidenceFloor:0.6
- `bestBetsScoreWeights` — edge:0.35, trust:0.25, readiness:0.20, uniqueness:0.10, boardFit:0.10
- `promotionStatuses` — `['not_eligible','eligible','qualified','promoted','suppressed','expired']`
- `promotionTargets` — `['best-bets','trader-insights']`

---

## packages/domain — Key Files

```
packages/domain/src/
├── index.ts                 # Re-exports all modules
├── promotion.ts             # evaluatePromotionEligibility() — 15 gates
├── probability/
│   ├── devig.ts             # americanToImplied, devig methods, consensus, edge, CLV
│   ├── probability-layer.ts # pFinal, uncertainty, confidence, CLV forecast
│   └── calibration.ts       # Brier score, log loss, ECE, reliability buckets
├── outcomes/
│   ├── outcome-resolver.ts
│   ├── loss-attribution.ts
│   └── settlement-downstream.ts  # computeSettlementDownstreamBundle()
├── features/                # Market feature extraction
├── models/                  # Prediction models
├── signals/                 # Signal processing
├── bands/                   # Calibration bands
├── calibration/             # Calibration pipeline
├── scoring/                 # Score pipeline
├── evaluation/              # Evaluation metrics
├── edge-validation/         # Edge validation
├── rollups/                 # Performance rollups
├── system-health/           # Health metrics
├── risk/                    # Risk/kelly sizing
└── strategy/                # Strategy logic
```

**Note:** `strategy/`, `calibration/`, `evaluation/` are NOT re-exported from top-level domain index due to name collisions. Import directly from their paths.

---

## packages/db — Key Files

```
packages/db/src/
├── index.ts                      # Re-exports all modules
├── database.types.ts             # GENERATED — never hand-edit (from Supabase)
├── types.ts                      # *Row types (Tables<>), *Record aliases, status unions
├── repositories.ts               # Repository interfaces (PickRepository, etc.)
├── runtime-repositories.ts       # InMemory* + Database* implementations
├── lifecycle.ts                  # transitionPickLifecycle(), ensurePickLifecycleState()
└── client.ts                     # createDatabaseClient(), UnitTalkSupabaseClient
```

**Allowed lifecycle transitions:**
```
validated → queued | voided
queued    → posted | voided
posted    → settled | voided
settled   → (terminal)
voided    → (terminal)
```

---

## supabase/migrations — All 8 Files

| File | Purpose |
|------|---------|
| `202603200001_v2_foundation.sql` | 11 canonical tables, constraints, indexes |
| `202603200002_v2_schema_hardening.sql` | Triggers, idempotency keys, lifecycle columns |
| `202603200003_distribution_receipts_idempotency.sql` | `idempotency_key` on distribution_receipts |
| `202603200004_system_runs_finished_at_trigger.sql` | Server-side `finished_at` clock fix |
| `202603200005_pick_promotion_state.sql` | `promotionDecidedAt` tracking |
| `202603200006_settlement_runtime_alignment.sql` | Settlement schema hardening |
| `202603200007_promotion_target_multi.sql` | Extend promotion targets to include `trader-insights` |
| `202603200008_reference_data_foundation.sql` | Reference data tables |

---

## docs/ — Authority Files

| File | Role |
|------|------|
| `docs/06_status/PROGRAM_STATUS.md` | **Canonical active program status** — wins on conflict |
| `docs/06_status/system_snapshot.md` | Runtime evidence: specific IDs, receipts, proof chains |
| `docs/05_operations/SPRINT_MODEL_v2.md` | Operating model: T1/T2/T3 risk-tiered sprints |
| `docs/05_operations/docs_authority_map.md` | Authority tier map for all docs |
| `docs/audits/v2_score_promotion_truth_audit.md` | Code-grounded promotion/scoring audit |
| `docs/discord/pick_promotion_interim_policy.md` | Promotion interim policy (ACTIVE) |
| `docs/discord/discord_embed_system_spec.md` | Discord embed specs + EV/edge display policy |

---

## Key Scripts (from root package.json)

```bash
pnpm test              # All 534 tests (6 groups, chained &&)
pnpm test:apps         # apps/* tests only
pnpm test:verification # packages/verification tests
pnpm test:domain-*     # domain package test groups
pnpm type-check        # TypeScript project-references check
pnpm build             # Compile all packages + apps
pnpm lint              # ESLint
pnpm verify            # env:check + lint + type-check + build + test
pnpm supabase:types    # Regenerate database.types.ts from live Supabase
pnpm test:db           # DB smoke test (requires live Supabase creds)
```

**Run single file:**
```bash
tsx --test apps/api/src/promotion-edge-integration.test.ts
```
