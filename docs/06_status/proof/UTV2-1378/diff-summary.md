# UTV2-1378 — Diff Summary

## What changed

**New file: `.github/workflows/proof-gate.yml`**
Consolidated workflow replacing three separate CI checks. Architecture:
- `detect` job: checks changed paths (proof/, lanes/, scripts/ops/) and PR labels (tier:T1, proof-required) using git diff
- `proof-auditor` job (C1): runs `proof-auditor-gate.ts` — only when proof paths changed or proof-required label
- `runtime-verifier` job (C2): runs `runtime-verifier-gate.ts` — only when runtime-sensitive paths changed
- `t1-proof` job (C3): enforces T1 pre-closure checklist (C1-C6) — only when tier:T1 label; requires C1 and C2 to pass/skip first

**Modified: `.github/workflows/proof-auditor-gate.yml`** — disabled (trigger → workflow_dispatch only)
**Modified: `.github/workflows/runtime-verifier-gate.yml`** — disabled (trigger → workflow_dispatch only)  
**Modified: `.github/workflows/t1-proof-gate.yml`** — disabled (trigger → workflow_dispatch only)

**Modified: `scripts/ops/workflow-hardening.test.ts`**
- Updated `required pull-request gates` test: `proof-auditor-gate.yml` → `proof-gate.yml` (job: proof-auditor), `runtime-verifier-gate.yml` → `proof-gate.yml` (job: runtime-verifier)
- Updated `proof and runtime gates watch paths` test: now verifies detect-job step content rather than `on.pull_request.paths` (since proof-gate.yml uses no path filter — all PRs trigger, detect determines what runs)

## Files not changed

- `.github/workflows/return-review-packet.yml` — kept as-is; merge-gate integration deferred
- `.github/workflows/merge-gate.yml` — not modified this lane

## Why consolidation

Three separate proof workflow files with different path-based triggers created redundant CI contexts and potential race conditions on T1 PRs. A single workflow with a detect→dispatch pattern:
1. Eliminates 3 CI check name slots, replacing with 3 jobs in one workflow
2. Enforces linear check sequence (C1 and C2 before C3)
3. Avoids path-filter races where the three workflows could trigger in different orders
4. Allows the T1 check (label-based) to run regardless of which paths changed

## Risk assessment

**Low risk.** This lane only modifies GitHub Actions YAML files and one test file. The actual proof-gate logic is a structural copy of the existing t1-proof-gate.yml, proof-auditor-gate.yml, and runtime-verifier-gate.yml. No source code, domain logic, or schema changes.

The disabled workflows are kept in the repo with `workflow_dispatch:` triggers for historical reference. They can be deleted in a future hygiene lane.

## Merge SHA

Merged to main: `16afce5fa6703f1d386e7b21829d2fd3ee6e8b89`
