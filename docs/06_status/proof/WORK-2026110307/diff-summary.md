# Diff summary: WORK-2026110307

Source SHA: 1a8850d5092088016a9f2372192af09aa718853b

The PM finding 4482558564 showed that a count-restoring membership swap could pass the lifecycle reader's net-count guard. Single-page reads still use one statement. Multi-page reads now discard a probe, acquire an unfiltered picks.updated_at watermark, restart with fresh count/state, and check changed rows in the read range, remaining members beyond the cursor for unbounded reads, and the final exact count. Three bounded attempts discard all failed rows and surface the last count or membership error. The shared keyset helper and other five callbacks are unchanged.

Focused tests: 192 pass, 0 fail, 1 credential skip; paging 125 pass. T1–T7 cover count-restoring swaps, hard delete/insert, repeated drift, single-page requests, bounded reads and probe discard/order. Isolated controls pass; removing range-change/beyond checks fails T2/T3; gte and Date rounding mutations fail microsecond coverage. Prior mutation results remain in the proof.

Current-source live proof is now bound to green staging CI run 42218315166 / job 127894343168; older successful runs 42050230261, 42053943830 and 42057587335 remain superseded. Local DB proof refused unresolved host=127.0.0.1 before writes. No schema/index/production changes, final main sync brought only readiness-score.json; no PR mutation or comments.

The guard cannot detect every same-count swap from a transaction started before W; its timing window is unmeasured. Unrelated picks updates in the covered range can exhaust retries and correctly fail closed. Cost adds one discarded page, W and up to three HEAD counts. Production behavior is unproven. Static verification PASS: 8109 passed, 0 failed, 13 skipped. Full verify exited 1 only at the staging identity guard. Attempt 11 preflight (including CEP-E3/E5/E7), proof identity, auditor and R-level pass; proof binding fails because the authorized readiness-score.json merge changed a non-proof path after the verified source SHA. This rejection is reported without workaround; the source binding is unchanged. Final gate outcomes are recorded in verification.md/evidence.json; no PM approval, merge or closeout is claimed.

Merge SHA: 6d96159dc02440be0aa449609a736afc2bfaef1b
