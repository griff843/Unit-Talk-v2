# Diff summary: WORK-2026110307

Source SHA: c069e2af7040daa59b46c3cbb2bd755af8727955

All six cursor readers now apply a shared redundant timestamp bound before the exact `(created_at, id)` OR predicate, enabling index seeks while preserving full timestamp precision and ascending/descending order. Lifecycle-state readers count the full population at read boundaries only; cursor pages no longer request exact remainder counts. Net count or result-length drift discards the read and retries at most three times. Status, duplicate, strict order and safety-budget checks remain fail-closed.

Unit coverage checks bounds in both directions and all six SDK query shapes. Live boundary/mutation controls now call the shared helper. Focused suites: 181 passed, 0 failed, 1 staging skip. All four mutations fail tests. Prior source staging receipts are superseded, and fresh runtime queries/row_counts are empty pending staging-ci. Run 42044986080's timeout and its index-scan cause are recorded in verification.md and evidence.json.

Net-count detection cannot detect an insert and delete that cancel out during a read; per-page counts did not detect that either. No schema/index changes or production writes. Main readiness update 4d34da992 was merged without conflicts. Historical source changes also include the live suite registration, writer inventory classification and server paging fixture identities.

Verification: static gate failed on the out-of-scope member-performance-service test double; scope extension requested. Full verify failed at the same static gate; test:live-db was not reached. R-level, proof identity and auditor pass; close eligibility and binding are blocked by deferred runtime receipts. Local test:db refused host=127.0.0.1 before writes. No production runtime proof, PM approval or merge is claimed. Changes are committed locally; push withheld pending the scope decision. PR #1832 remains unchanged and draft; authorized outer closeout remains pending.

Merge SHA: pending merge
