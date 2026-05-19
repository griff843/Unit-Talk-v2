# Diff Summary — UTV2-1045: Expand Runtime Verifier Gate

## Change

File modified: `.github/workflows/runtime-verifier-gate.yml`

## Before

The `on.pull_request.paths` filter contained a single entry:

```yaml
paths:
  - 'docs/06_status/proof/**'
```

## After

The `on.pull_request.paths` filter now covers four categories of paths:

```yaml
paths:
  # Proof paths — direct evidence changes always trigger the gate
  - 'docs/06_status/proof/**'
  # Lane closeout paths — manifest and ops-script changes can affect gate validity
  - 'docs/06_status/lanes/**'
  - 'scripts/ops/**'
  # R-level artifact output paths
  - 'artifacts/**'
  # Runtime-sensitive paths (R-level classified per r1-r5-rules.json)
  # lifecycle-fsm (R1–R4)
  - 'apps/api/src/submission-service.ts'
  - 'apps/api/src/candidate-pick-scanner.ts'
  - 'packages/domain/src/lifecycle/**'
  - 'apps/worker/**'
  # promotion-scoring (R1–R3)
  - 'packages/domain/src/promotion/**'
  - 'apps/api/src/promotion-service.ts'
  # settlement-grading (R1–R4)
  - 'apps/api/src/settlement-service.ts'
  - 'packages/domain/src/grading/**'
  - 'packages/domain/src/clv/**'
  # strategy-bankroll (R5)
  - 'packages/domain/src/strategy/**'
  # ingestor-provider (R1)
  - 'apps/ingestor/**'
  # DB runtime repositories (proof-coverage-guard sensitive paths)
  - 'packages/db/src/lifecycle.ts'
  - 'packages/db/src/repositories.ts'
  - 'packages/db/src/runtime-repositories.ts'
```

## Rationale

- **Proof paths** (unchanged): direct evidence changes always require gate validation.
- **Lane closeout paths** (`docs/06_status/lanes/**`, `scripts/ops/**`): manifest and ops-script changes can affect gate validity — a lane closing without a proof check is a governance gap.
- **R-level artifact output** (`artifacts/**`): R2–R5 artifact files are produced by and consumed by the runtime verifier; changes here must be gated.
- **Runtime-sensitive paths**: All R-level classified paths from `docs/05_operations/r1-r5-rules.json`:
  - `lifecycle-fsm` (R1–R4): submission-service, candidate-pick-scanner, lifecycle FSM, worker
  - `promotion-scoring` (R1–R3): promotion packages and service
  - `settlement-grading` (R1–R4): settlement-service, grading, CLV
  - `strategy-bankroll` (R5): strategy packages
  - `ingestor-provider` (R1): ingestor app
  - DB runtime repositories used by the live pipeline

## Impact

PRs touching any of these paths will now trigger the runtime-verifier-gate workflow, ensuring no runtime-sensitive change bypasses the proof gate due to a narrow path filter.
