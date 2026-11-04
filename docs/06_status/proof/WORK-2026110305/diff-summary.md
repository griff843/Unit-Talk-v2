# Diff summary: WORK-2026110305

The carried WORK-2026103007 live tests are completed under WORK-2026110305 and the contract-author retargeting ruling of 2026-11-03.

| File | Change |
|---|---|
| apps/api/src/t1-proof-work-2026103007-human-capper-delivery-live.test.ts | Staging-only real submission/authorization/release; canonical pending, unclaimed official-picks outbox and pinned destination assertions; Track Only negative control; allowlist-removal mutation. |
| apps/worker/src/t1-proof-work-2026103007-human-capper-delivery-live.test.ts | Run-owned fixture retarget with id/pick/status/unclaimed filters; real atomic claim/confirm with simulated Discord; owned kill-switch control; receipt, lifecycle, exactly-once and zero dispatch-ledger assertions. |
| docs/05_operations/db-writer-classification.json | Classify both credentialed suites under test:t1-proof:live. |
| package.json | Carried WIP registers API then worker as separate sequential processes in test:t1-proof:live. |

The API and worker halves share only persisted fixtures identified by the run-namespaced capper and pick ID. They do not import from each other. Existing lane/sync/model scaffolds predate this implementation.

## Proof limits

The real-persistence assertions require the staging-ci environment and have not executed locally. Discord is a stub: no Discord delivery is claimed. Moving the API-created pending row from official-picks to the unique target is an authorized test-fixture operation, not production behavior. The official-picks claim path is not exercised. The governed-target dispatch ledger is not proven here; existing in-memory ledger tests cover it and the production canary must evidence it. No ledger rows are fabricated. Only the owned namespaced kill-switch row is written and deleted; real target switches remain untouched.

## SHA Binding

Implementation SHA: c91ac116c024bf9029788fd0a8939cae5c6291c9
Merge SHA: pending merge
PR: deferred to Production Claude under the explicit staging-slot sequencing override.

## Rework

Implementation baf1164999da78df5c218733b8d0db8435d8b4ff isolates bet identity from the preceding live suite, reads back the seeded capper, adds primary-ID attribution diagnostics for both API picks, and passes the delivery pick ID through owned capper metadata to the worker. The local idempotency experiment reproduced the old collision and confirmed different corrected keys. No production code, target policy, switch ownership, adapter, or ledger behavior changed. Existing PR: #1826; corrected exact-head staging proof remains pending.
