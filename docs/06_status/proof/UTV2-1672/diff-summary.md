# DIFF SUMMARY: UTV2-1672

MERGE_SHA: 15eee48254c0141cf739a23ecc4add0f519a6fe9

Head: 15eee48254c0141cf739a23ecc4add0f519a6fe9
Base: ea7b26334f67ced32bb19ded92c5f303a61aef56
PR: https://github.com/griff843/Unit-Talk-v2/pull/1466

33 files changed. The table below lists the 29 of them outside this proof
bundle: 4368 insertions, 48 deletions. The bundle's own four paths are
excluded from the table rather than carried at a stale count, because their
line counts move with every proof-only edit including this one.

## Changed files

| File | Delta |
|---|---|
| `.ops/sync/UTV2-1672.yml` | +474 / -0 |
| `apps/api/src/controllers/requeue-controller.ts` | +7 / -1 |
| `apps/api/src/controllers/retry-delivery-controller.ts` | +11 / -0 |
| `apps/api/src/controllers/submit-pick-controller.test.ts` | +225 / -1 |
| `apps/api/src/controllers/submit-pick-controller.ts` | +42 / -1 |
| `apps/api/src/distribution-service.test.ts` | +462 / -0 |
| `apps/api/src/distribution-service.ts` | +18 / -1 |
| `apps/api/src/handlers/reference-data.ts` | +65 / -4 |
| `apps/api/src/handlers/submit-pick.ts` | +67 / -3 |
| `apps/api/src/http-integration.test.ts` | +308 / -1 |
| `apps/api/src/recap-service.test.ts` | +107 / -0 |
| `apps/api/src/recap-service.ts` | +18 / -0 |
| `apps/api/src/routes/health.ts` | +18 / -1 |
| `apps/api/src/routes/index.ts` | +1 / -0 |
| `apps/api/src/routes/reference-data.ts` | +25 / -2 |
| `apps/api/src/run-audit-service.test.ts` | +138 / -1 |
| `apps/api/src/run-audit-service.ts` | +21 / -1 |
| `apps/api/src/server.test.ts` | +225 / -0 |
| `apps/api/src/server.ts` | +5 / -0 |
| `apps/api/src/smart-form-validation.test.ts` | +1022 / -0 |
| `apps/api/src/smart-form-validation.ts` | +570 / -0 |
| `apps/api/src/submission-service.test.ts` | +40 / -4 |
| `apps/api/src/t1-proof-awaiting-approval.test.ts` | +188 / -0 |
| `docs/06_status/lanes/UTV2-1672.json` | +61 / -0 |
| `package.json` | +1 / -1 |
| `packages/contracts/src/index.ts` | +1 / -0 |
| `packages/contracts/src/smart-form.ts` | +57 / -0 |
| `packages/db/src/repositories.ts` | +1 / -0 |
| `packages/db/src/runtime-repositories.ts` | +190 / -26 |

## What each file does

### New: the Smart Form contract and its validator

- **`packages/contracts/src/smart-form.ts`** (new) — the `SmartFormParticipantResolution`
  discriminated union (`canonical` | `manual`) and `isTrackOnlyPickMetadata`.
  Exported from `packages/contracts/src/index.ts`.
- **`apps/api/src/smart-form-validation.ts`** (new) — `validateSmartFormRelationships`.
  Carries `SMART_FORM_TRIGGER_SCOPE`, `SMART_FORM_RELATIONSHIP_GUARD`,
  `CANONICAL_SPORT_ID_GUARD` and `MANUAL_COVERAGE_GAP_PROOF_GUARD`, plus the
  alias-normalisation helpers (`foldConfusables`, `CONFUSABLE_LATIN`,
  `LATIN_EXPANSION`, `isDefaultIgnorable`, `aliasKey`, `isSameEntityName`,
  `findCanonicalCoverage`).

### The Track Only chokepoint

- **`packages/db/src/runtime-repositories.ts`** — `OUTBOX_TRACK_ONLY_CHOKEPOINT_GUARD`
  in both `InMemoryOutboxRepository.enqueue` and `DatabaseOutboxRepository.enqueue`;
  `ATOMIC_TRACK_ONLY_CHOKEPOINT_GUARD` in `enqueueDistributionAtomic`;
  `loadPickMetadata` now refuses an absent or unreadable pick row instead of
  treating it as delivery-eligible; `DatabaseOutboxRepository` takes an optional
  injected client so the chokepoint is testable.

### Per-path Track Only guards (defence in depth)

- **`apps/api/src/handlers/submit-pick.ts`** — `CAPPER_TRACK_ONLY_PIN_GUARD`,
  `CAPPER_SOURCE_PIN_GUARD`, `SMART_FORM_HTTP_CONTRACT_GUARD`.
- **`apps/api/src/controllers/submit-pick-controller.ts`** — `TRACK_ONLY_DIRECT_ENQUEUE_GUARD`,
  `TRACK_ONLY_REQUEST_INTEGRITY_GUARD`.
- **`apps/api/src/controllers/requeue-controller.ts`** — `TRACK_ONLY_REQUEUE_GUARD`.
- **`apps/api/src/controllers/retry-delivery-controller.ts`** — `TRACK_ONLY_RETRY_GUARD`.
- **`apps/api/src/run-audit-service.ts`** — `TRACK_ONLY_ATOMIC_GUARD` (pre-atomic).
- **`apps/api/src/distribution-service.ts`** — Track Only refusal at the enqueue caller.

### The recap fix

- **`apps/api/src/recap-service.ts`** — `RECAP_TRACK_ONLY_EXCLUSION_GUARD`. Without
  it, a settled Track Only pick with the day's best result becomes `topPlay`,
  hits the new outbox chokepoint, throws, and silently kills the recap.
  **Outside the declared file scope — covered by the requested scope-override.**

### The zombie-health and board-capacity fixes

- **`apps/api/src/routes/health.ts`** — `ZOMBIE_HEALTH_TRACK_ONLY_EXCLUSION_GUARD`.
  A Track Only pick is force-qualified to best-bets and never enqueued, matching
  every clause of the zombie predicate; without this `/health` 503s after the
  first legitimate capper submission and prescribes a requeue the Track Only
  guard refuses. **Outside the declared file scope — covered by the requested
  scope-override.**
- **`packages/db/src/runtime-repositories.ts`** — `BOARD_CAPACITY_TRACK_ONLY_EXCLUSION_GUARD`
  in both `getPromotionBoardState` implementations, so Track Only picks do not
  hold live board capacity for 7 days and suppress deliverable picks.

### Health and board capacity

- **`apps/api/src/routes/health.ts`** — `ZOMBIE_HEALTH_TRACK_ONLY_EXCLUSION_GUARD`.
  A Track Only pick sits at `qualified` / `best-bets` / `validated` with no
  outbox row, which the zombie-pick health probe reads as a delivery fault and
  reports as a degraded system needing requeue. The guard skips Track Only
  picks. **Outside the declared file scope — covered by the requested
  scope-override.**

### Wiring

- **`apps/api/src/server.ts`, `routes/index.ts`, `routes/reference-data.ts`,
  `handlers/reference-data.ts`** — reference-data catalog and search endpoints
  the Smart Form resolves against.
- **`packages/db/src/repositories.ts`** — repository interface addition.
- **`package.json`** — one line: `test:apps-api-core` gains
  `apps/api/src/smart-form-validation.test.ts` so the new suite executes under
  required `verify` rather than being unwired.
  **Outside the declared file scope — covered by the requested scope-override.**

### Tests

1022 lines of new Smart Form validation tests plus additions to eight existing
suites. 16 of these are mutation controls, against 17 guards.
BOARD_CAPACITY_TRACK_ONLY_EXCLUSION_GUARD has no mutation control: it lives in
`packages/db`, which an `apps/api` test cannot import as source without
violating the db-client-boundary check. It is proven by premise assertion
instead, and labelled as the weaker proof in verification.md.
`apps/api/src/recap-service.test.ts` is **outside the declared file scope —
covered by the requested scope-override.**

### Closing the two PM blockers

- **`apps/api/src/t1-proof-awaiting-approval.test.ts`** — a UTV2-1672 section
  proving the Track Only chokepoint against real Postgres rather than an
  in-memory repository and a stub client. Three cases run through the real
  submit-pick controller against real repositories: a Track Only submission
  persists `distributionMode=track-only` and creates no `distribution_outbox`
  row; `DatabaseOutboxRepository` — the repository production actually runs —
  refuses to enqueue that persisted pick; and no outbox row exists for any
  fixture from the run. The second case asserts `TrackOnlyDeliveryForbiddenError`
  specifically, not merely that it threw, because the chokepoint raises a
  different error when it cannot read the pick row: asserting only rejection
  would have passed for the wrong reason. Fixtures are voided through the
  lifecycle FSM in an `after` hook, never a direct status PATCH, and the hook
  asserts zero outbox rows per fixture. The file was already registered in
  `db-writer-classification.json` and already runs under `pnpm test:t1-proof:live`,
  so no registry change, no new lane and no widened lane authority are involved.
  **Outside the declared file scope — covered by the requested scope-override.**
  I had previously reported this work as blocked. That was wrong: it was blocked
  only for a *new* proof file, and extending an existing registered one was
  available the whole time.
- **`packages/db/src/runtime-repositories.ts`** — `searchPlayers` fetched an
  unordered global `limit * 5` batch of name matches and only then filtered by
  sport, so a sport whose players fell outside that arbitrary slice reported no
  availability even though canonical players existed, and the result was not
  stable between calls. Availability is a refusal input for Smart Form coverage,
  so this returned a wrong answer, not merely a slow one. The name match is now
  paged in a deterministic order with the sport filter applied per page, bounded
  by how many players actually match the query rather than by a fixed
  cross-sport cap; paging stops as soon as the limit is met, so the common case
  remains one round trip. `DatabaseReferenceDataRepository` gains an optional
  injected client, mirroring `DatabaseOutboxRepository` in this same lane, so
  the path is reachable from a test without a live connection; production still
  passes a connection config.

## Files deliberately NOT changed

- `apps/smart-form/**`, `apps/qa-agent/**` — Lane 2 (UTV2-1786).
- `apps/worker/**` — three round-2 findings were deferred rather than fixed here.
- Migrations, lifecycle FSMs, governance brake sources, worker/Discord delivery
  targets, production rows or configuration, ingestion or member-delivery state.
- `.lane/lanes/runtime.yml` — no lane authority widening. A live-DB proof test
  was withdrawn rather than amend it; see verification.md.
