# Diff summary: WORK-2026110307

Source SHA: f6a694f78c7124cd43ee772a15b2ca22b9bc88ae

All six cursor readers now apply a shared redundant timestamp bound before the exact `(created_at, id)` OR predicate, enabling index seeks while preserving full timestamp precision and ascending/descending order. Lifecycle-state readers use the first page count as their authoritative single-statement snapshot and issue an ending HEAD count only after a cursor data page; cursor pages no longer request exact remainder counts. Net count or result-length drift discards the read and retries at most three times. Status, duplicate, strict order and safety-budget checks remain fail-closed.

Unit coverage checks bounds in both directions and all six SDK query shapes. Live boundary/mutation controls now call the shared helper. Focused suites: 185 passed, 0 failed, 1 staging skip. The prior four mutation controls remain recorded; the new always-skip-end-count mutation fails five tests. Single-page requests need no HEAD count; multi-page drift still retries three times and fails closed. Prior source staging receipts are superseded, and fresh runtime queries/row_counts are empty pending staging-ci. Run 42044986080's timeout and its index-scan cause are recorded in verification.md and evidence.json.

Net-count detection cannot detect an insert and delete that cancel out during a read; per-page counts did not detect that either. No schema/index changes or production writes. Main readiness update 4d34da992 was merged without conflicts. Historical source changes also include the live suite registration, writer inventory classification and server paging fixture identities.

Verification: `pnpm verify:static` passed through the full verify command (8102 passed, 0 failed, 13 skipped). The prior member-performance-service test-double blocker is resolved without changing that file. Full verify then exited 1 at the staging identity guard; local test:db also refused host=127.0.0.1 before writes. R-level, proof identity and auditor pass; CEP-E3/E5 pass; close eligibility and binding remain blocked by deferred runtime receipts. No production runtime proof, PM approval or merge is claimed. Local source/proof commits are prepared for the one authorized final push. PR #1832 remains open, draft and tier:T1; authorized outer closeout remains pending.

Merge SHA: pending merge
